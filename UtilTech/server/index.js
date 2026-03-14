import cors from 'cors'
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const utilRoot = path.resolve(__dirname, '..')
const modRoot = path.resolve(utilRoot, '..')
const repoRoot = path.resolve(modRoot, '..', '..', '..')

const techRoot = path.resolve(modRoot, 'common', 'technologies')
const equipmentRoot = path.resolve(modRoot, 'common', 'units', 'equipment')
const interfaceRoot = path.resolve(modRoot, 'interface')
const locZhRoot = path.resolve(modRoot, 'localisation', 'simp_chinese')
const locEnRoot = path.resolve(modRoot, 'localisation', 'english')

const generatedTechFile = path.resolve(techRoot, 'zz_pw_utiltech_generated.txt')
const generatedEquipmentFile = path.resolve(equipmentRoot, 'zz_pw_utiltech_generated.txt')
const generatedLocZhFile = path.resolve(locZhRoot, 'zz_pw_utiltech_l_simp_chinese.yml')
const generatedLocEnFile = path.resolve(locEnRoot, 'zz_pw_utiltech_l_english.yml')
const techCategoryReferenceFile = path.resolve(repoRoot, '基础代码', '代码提词器', '原版科技种类.txt')
const equipmentReferenceFile = path.resolve(repoRoot, '基础代码', '代码提词器', '装备类型汇总.txt')

const app = express()
app.use(cors())
app.use(express.json({ limit: '20mb' }))

const TECH_MODIFIER_HINTS = [
  'political_power_gain',
  'research_speed_factor',
  'stability_factor',
  'war_support_factor',
  'local_resources_factor',
  'production_speed_buildings_factor',
  'production_factory_efficiency_gain_factor',
  'industrial_capacity_factory',
  'industrial_capacity_dockyard',
  'army_org_factor',
  'army_morale_factor',
  'planning_speed',
  'max_planning',
  'army_speed_factor',
  'supply_consumption_factor',
]

const EQUIPMENT_MODIFIER_HINTS = [
  'build_cost_ic',
  'lend_lease_cost',
  'reliability',
  'maximum_speed',
  'defense',
  'breakthrough',
  'hardness',
  'armor_value',
  'soft_attack',
  'hard_attack',
  'ap_attack',
  'air_attack',
  'manpower',
  'air_defence',
  'air_range',
  'air_agility',
  'air_ground_attack',
  'air_bombing',
  'air_superiority',
  'naval_strike_attack',
  'naval_strike_targetting',
  'naval_speed',
  'naval_range',
  'sub_attack',
  'surface_detection',
  'sub_detection',
]

const stripComments = (text) => text.replace(/#.*$/gm, '')
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const findMatchingBrace = (text, braceStart) => {
  if (braceStart < 0 || text[braceStart] !== '{') return -1
  let depth = 1
  let i = braceStart + 1
  let inString = false
  while (i < text.length && depth > 0) {
    const ch = text[i]
    if (ch === '"' && text[i - 1] !== '\\') {
      inString = !inString
    } else if (!inString) {
      if (ch === '{') depth += 1
      if (ch === '}') depth -= 1
      if (ch === '#') {
        while (i < text.length && text[i] !== '\n') i += 1
      }
    }
    i += 1
  }
  return depth === 0 ? i : -1
}

const findContainerRange = (text, containerKey) => {
  const matcher = new RegExp(`\\b${escapeRegExp(containerKey)}\\b\\s*=`)
  const match = matcher.exec(text)
  if (!match) return null
  const braceStart = text.indexOf('{', match.index)
  if (braceStart < 0) return null
  const end = findMatchingBrace(text, braceStart)
  if (end < 0) return null
  return {
    fullStart: match.index,
    blockStart: braceStart,
    fullEnd: end,
    innerStart: braceStart + 1,
    innerEnd: end - 1,
  }
}

const isIdentifierChar = (ch) => /[A-Za-z0-9_\.:-]/.test(ch)

const parseTopLevelBlocksInRange = (text, start, end) => {
  const blocks = []
  let i = start
  while (i < end) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '#') {
      while (i < end && text[i] !== '\n') i += 1
      continue
    }
    if (!isIdentifierChar(ch)) {
      i += 1
      continue
    }
    let keyEnd = i + 1
    while (keyEnd < end && isIdentifierChar(text[keyEnd])) keyEnd += 1
    const key = text.slice(i, keyEnd)
    let cursor = keyEnd
    while (cursor < end && /\s/.test(text[cursor])) cursor += 1
    if (text[cursor] !== '=') {
      i = keyEnd
      continue
    }
    cursor += 1
    while (cursor < end && /\s/.test(text[cursor])) cursor += 1
    if (text[cursor] !== '{') {
      i = cursor
      continue
    }
    const blockStart = cursor
    const blockEnd = findMatchingBrace(text, blockStart)
    if (blockEnd < 0 || blockEnd > end) break
    blocks.push({
      key,
      start: i,
      end: blockEnd,
      bodyStart: blockStart + 1,
      bodyEnd: blockEnd - 1,
      raw: text.slice(i, blockEnd),
      body: text.slice(blockStart + 1, blockEnd - 1).trim(),
    })
    i = blockEnd
  }
  return blocks
}

const readAllFilesRecursive = async (rootDir, suffix = '.txt') => {
  const result = []
  const walk = async (dir) => {
    let entries = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.resolve(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) {
        result.push(full)
      }
    }
  }
  await walk(rootDir)
  return result
}

const normalizeSpace = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const parseWhitespaceList = (value) => normalizeSpace(value).split(' ').filter(Boolean)

const getTopLevelLines = (raw) => {
  const lines = raw.split(/\r?\n/)
  const output = []
  let depth = 0
  let inString = false
  for (const line of lines) {
    if (depth === 0) {
      output.push(line)
    }
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '"' && line[i - 1] !== '\\') {
        inString = !inString
      } else if (!inString) {
        if (ch === '{') depth += 1
        if (ch === '}') depth = Math.max(0, depth - 1)
        if (ch === '#') break
      }
    }
  }
  return output
}

const extractSimpleValue = (raw, key) => {
  const matcher = new RegExp(`(^|\\n)\\s*${escapeRegExp(key)}\\s*=\\s*([^\\n#{}]+)`, 'm')
  const match = raw.match(matcher)
  return match ? normalizeSpace(match[2]) : ''
}

const extractInlineList = (raw, key) => {
  const matcher = new RegExp(`(^|\\n)\\s*${escapeRegExp(key)}\\s*=\\s*\\{([^}]*)\\}`, 'm')
  const match = raw.match(matcher)
  if (!match) return []
  return parseWhitespaceList(match[2])
}

const extractNamedBlockBody = (raw, key) => {
  const matcher = new RegExp(`\\b${escapeRegExp(key)}\\b\\s*=`)
  const match = matcher.exec(raw)
  if (!match) return ''
  const braceStart = raw.indexOf('{', match.index)
  if (braceStart < 0) return ''
  const end = findMatchingBrace(raw, braceStart)
  if (end < 0) return ''
  return raw.slice(braceStart + 1, end - 1).trim()
}

const parseTopLevelModifiers = (raw, reservedKeys) => {
  const lines = getTopLevelLines(raw)
  const modifiers = []
  for (const line of lines) {
    const pure = stripComments(line).trim()
    const match = pure.match(/^([A-Za-z0-9_.:-]+)\s*=\s*(-?\d+(?:\.\d+)?)$/)
    if (!match) continue
    const key = match[1]
    if (reservedKeys.has(key)) continue
    modifiers.push({ key, value: match[2] })
  }
  return modifiers
}

const parseLocalizationsFromFile = async (filePath, map) => {
  let text = ''
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch {
    return
  }
  const normalized = text.replace(/^\uFEFF/, '')
  const lines = normalized.split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z0-9_.:-]+):\d*\s*"(.*)"\s*$/)
    if (!match) continue
    map.set(match[1], match[2].replace(/\\"/g, '"'))
  }
}

const loadLocalizationMap = async (rootDir) => {
  const files = await readAllFilesRecursive(rootDir, '.yml')
  const map = new Map()
  for (const file of files) {
    await parseLocalizationsFromFile(file, map)
  }
  return map
}

const loadReferenceMap = async (filePath) => {
  const map = new Map()
  let text = ''
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch {
    return map
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  for (const line of lines) {
    const pure = line.replace(/#.*$/, '').trim()
    if (!pure) continue
    const match = pure.match(/^([A-Za-z0-9_.:-]+)\s*=\s*(.+)$/)
    if (!match) continue
    const key = normalizeSpace(match[1])
    const value = normalizeSpace(match[2])
    if (!key || !value) continue
    map.set(key, value)
  }
  return map
}

const loadReferenceContext = async () => {
  const [technologyCategories, equipmentTypes] = await Promise.all([
    loadReferenceMap(techCategoryReferenceFile),
    loadReferenceMap(equipmentReferenceFile),
  ])
  return { technologyCategories, equipmentTypes }
}

const getAllNamedBlockBodies = (raw, key) => {
  const list = []
  let cursor = 0
  while (cursor < raw.length) {
    const matcher = new RegExp(`\\b${escapeRegExp(key)}\\b\\s*=`, 'g')
    matcher.lastIndex = cursor
    const match = matcher.exec(raw)
    if (!match) break
    const braceStart = raw.indexOf('{', match.index)
    if (braceStart < 0) break
    const end = findMatchingBrace(raw, braceStart)
    if (end < 0) break
    list.push(raw.slice(braceStart + 1, end - 1).trim())
    cursor = end
  }
  return list
}

const parseTopLevelBlocksFromBody = (raw) => {
  const wrapped = `__root__ = {\n${raw}\n}`
  const container = findContainerRange(wrapped, '__root__')
  if (!container) return []
  return parseTopLevelBlocksInRange(wrapped, container.innerStart, container.innerEnd)
}

const parseScalarTopLevelAssignments = (raw) => {
  const lines = getTopLevelLines(raw)
  const result = {}
  for (const line of lines) {
    const pure = stripComments(line).trim()
    if (!pure || pure.includes('{') || pure.includes('}')) continue
    const match = pure.match(/^([A-Za-z0-9_.:-]+)\s*=\s*(.+)$/)
    if (!match) continue
    const key = normalizeSpace(match[1])
    const value = normalizeSpace(match[2])
    if (!key || !value) continue
    result[key] = value
  }
  return result
}

const parseDependencyWeights = (body) => {
  const result = []
  const lines = String(body ?? '').split(/\r?\n/)
  for (const line of lines) {
    const pure = stripComments(line).trim()
    const match = pure.match(/^([A-Za-z0-9_.:-]+)\s*=\s*(-?\d+(?:\.\d+)?)$/)
    if (!match) continue
    result.push({ tech: match[1], weight: match[2] })
  }
  return result
}

const parsePosition = (body) => {
  const x = extractSimpleValue(body, 'x')
  const y = extractSimpleValue(body, 'y')
  if (!x && !y) return null
  return { x, y }
}

const parsePathBlocks = (raw) => {
  return getAllNamedBlockBodies(raw, 'path').map((body) => ({
    leads_to_tech: extractSimpleValue(body, 'leads_to_tech'),
    research_cost_coeff: extractSimpleValue(body, 'research_cost_coeff'),
    ignore_for_layout: extractSimpleValue(body, 'ignore_for_layout'),
    raw: body,
  }))
}

const parseEnableBuildingBlocks = (raw) => {
  return getAllNamedBlockBodies(raw, 'enable_building').map((body) => ({
    building: extractSimpleValue(body, 'building'),
    level: extractSimpleValue(body, 'level'),
    raw: body,
  }))
}

const parseTechnologyStructure = (body, refs) => {
  const technologyCategoriesRef = refs?.technologyCategories || new Map()
  const equipmentTypesRef = refs?.equipmentTypes || new Map()
  const scalar = parseScalarTopLevelAssignments(body)
  const folderBlocks = getAllNamedBlockBodies(body, 'folder')
  const folder = folderBlocks.map((item) => {
    const posBlock = extractNamedBlockBody(item, 'position')
    return {
      name: extractSimpleValue(item, 'name'),
      position: parsePosition(posBlock),
      raw: item,
    }
  })
  const categories = extractInlineList(body, 'categories')
  const enableEquipments = extractInlineList(body, 'enable_equipments')
  const enableSubunits = extractInlineList(body, 'enable_subunits')
  const enableModules = extractInlineList(body, 'enable_equipment_modules')
  const xor = extractInlineList(body, 'XOR')
  const subTechnologies = extractInlineList(body, 'sub_technologies')
  const dependencies = parseDependencyWeights(extractNamedBlockBody(body, 'dependencies'))
  const allow = extractNamedBlockBody(body, 'allow')
  const allowBranch = extractNamedBlockBody(body, 'allow_branch')
  const aiWillDo = extractNamedBlockBody(body, 'ai_will_do')
  const onResearchComplete = extractNamedBlockBody(body, 'on_research_complete')
  const onResearchCompleteLimit = extractNamedBlockBody(body, 'on_research_complete_limit')
  const pathBlocks = parsePathBlocks(body)
  const enableBuildings = parseEnableBuildingBlocks(body)

  const knownBlockKeys = new Set([
    'folder',
    'categories',
    'enable_equipments',
    'enable_subunits',
    'enable_equipment_modules',
    'XOR',
    'sub_technologies',
    'dependencies',
    'allow',
    'allow_branch',
    'ai_will_do',
    'on_research_complete',
    'on_research_complete_limit',
    'path',
    'enable_building',
  ])
  const unknownBlocks = parseTopLevelBlocksFromBody(body)
    .filter((block) => !knownBlockKeys.has(block.key))
    .map((block) => ({ key: block.key, raw: block.body }))

  return {
    scalar_fields: scalar,
    categories: categories.map((key) => ({ key, name: technologyCategoriesRef.get(key) || '' })),
    folder,
    enable_equipments: enableEquipments.map((key) => ({ key, name: equipmentTypesRef.get(key) || '' })),
    enable_subunits: enableSubunits,
    enable_equipment_modules: enableModules,
    dependencies,
    xor,
    sub_technologies: subTechnologies,
    paths: pathBlocks,
    enable_buildings: enableBuildings,
    triggers: {
      allow,
      allow_branch: allowBranch,
    },
    effects: {
      on_research_complete_limit: onResearchCompleteLimit,
      on_research_complete: onResearchComplete,
    },
    ai_will_do: aiWillDo,
    country_modifiers: parseTopLevelModifiers(body, RESERVED_TECH_KEYS),
    unknown_blocks: unknownBlocks,
  }
}

const parseKeyValuePairsFromBody = (body) => {
  const result = []
  const lines = String(body ?? '').split(/\r?\n/)
  for (const line of lines) {
    const pure = stripComments(line).trim()
    const match = pure.match(/^([A-Za-z0-9_.:-]+)\s*=\s*(-?\d+(?:\.\d+)?)$/)
    if (!match) continue
    result.push({ key: match[1], value: match[2] })
  }
  return result
}

const EQUIPMENT_STAT_GROUPS = {
  cost: ['build_cost_ic', 'lend_lease_cost', 'manpower'],
  mobility: ['maximum_speed', 'reliability'],
  offense_land: ['soft_attack', 'hard_attack', 'ap_attack', 'breakthrough', 'air_attack'],
  defense_land: ['defense', 'max_strength', 'armor_value', 'hardness', 'entrenchment'],
  naval: [
    'naval_speed',
    'naval_range',
    'lg_attack',
    'hg_attack',
    'torpedo_attack',
    'anti_air_attack',
    'sub_attack',
    'surface_detection',
    'sub_detection',
    'surface_visibility',
    'sub_visibility',
  ],
  air: [
    'air_attack',
    'air_defence',
    'air_range',
    'air_agility',
    'air_ground_attack',
    'air_bombing',
    'air_superiority',
    'naval_strike_attack',
    'naval_strike_targetting',
  ],
  special: ['recon', 'carrier_capable', 'is_convertable', 'can_license'],
}

const buildEquipmentStatGroups = (modifiers) => {
  const map = new Map((modifiers || []).map((item) => [item.key, item.value]))
  const groups = {}
  for (const [groupKey, keys] of Object.entries(EQUIPMENT_STAT_GROUPS)) {
    groups[groupKey] = keys
      .filter((key) => map.has(key))
      .map((key) => ({ key, value: map.get(key) }))
  }
  return groups
}

const parseEquipmentStructure = (body, refs) => {
  const equipmentTypesRef = refs?.equipmentTypes || new Map()
  const scalar = parseScalarTopLevelAssignments(body)
  const resourcesBody = extractNamedBlockBody(body, 'resources')
  const resources = parseKeyValuePairsFromBody(resourcesBody)
  const canBeProduced = extractNamedBlockBody(body, 'can_be_produced')
  const modifiers = parseTopLevelModifiers(body, RESERVED_EQUIPMENT_KEYS)
  const typeKey = extractSimpleValue(body, 'type')
  const archetypeKey = extractSimpleValue(body, 'archetype')
  const categoryKey = typeKey || archetypeKey || 'uncategorized'
  const knownBlockKeys = new Set(['resources', 'can_be_produced'])
  const unknownBlocks = parseTopLevelBlocksFromBody(body)
    .filter((block) => !knownBlockKeys.has(block.key))
    .map((block) => ({ key: block.key, raw: block.body }))

  return {
    scalar_fields: scalar,
    category: {
      key: categoryKey,
      name: equipmentTypesRef.get(categoryKey) || '',
    },
    resources,
    can_be_produced: canBeProduced,
    modifiers,
    stat_groups: buildEquipmentStatGroups(modifiers),
    unknown_blocks: unknownBlocks,
    archetype_chain: [],
    parent_chain: [],
  }
}

const RESERVED_TECH_KEYS = new Set([
  'research_cost',
  'start_year',
  'show_equipment_icon',
  'show_effect_as_desc',
  'xp_research_type',
  'xp_boost_cost',
  'xp_research_bonus',
  'xp_unlock_cost',
  'doctrine',
  'doctrine_name',
  'force_use_small_tech_layout',
])

const RESERVED_EQUIPMENT_KEYS = new Set([
  'year',
  'active',
  'archetype',
  'parent',
  'priority',
  'visual_level',
  'type',
  'group_by',
  'interface_category',
  'is_archetype',
  'is_buildable',
  'picture',
])

const parseTechnologyEntry = (block, filePath, locZh, locEn, refs) => {
  const body = block.body
  const categories = extractInlineList(body, 'categories')
  const folderName = extractSimpleValue(extractNamedBlockBody(body, 'folder'), 'name')
  const category = categories[0] || folderName || 'uncategorized'
  return {
    id: block.key,
    type: 'technology',
    category,
    categories,
    folderName,
    research_cost: extractSimpleValue(body, 'research_cost'),
    start_year: extractSimpleValue(body, 'start_year'),
    show_equipment_icon: extractSimpleValue(body, 'show_equipment_icon') === 'yes',
    enable_equipments: extractInlineList(body, 'enable_equipments'),
    enable_subunits: extractInlineList(body, 'enable_subunits'),
    modifiers: parseTopLevelModifiers(body, RESERVED_TECH_KEYS),
    raw: body,
    filePath,
    source: path.relative(modRoot, filePath),
    name_zh: locZh.get(block.key) || '',
    desc_zh: locZh.get(`${block.key}_desc`) || '',
    name_en: locEn.get(block.key) || '',
    desc_en: locEn.get(`${block.key}_desc`) || '',
    structured: parseTechnologyStructure(body, refs),
  }
}

const parseEquipmentEntry = (block, filePath, locZh, locEn, refs) => {
  const body = block.body
  const structured = parseEquipmentStructure(body, refs)
  return {
    id: block.key,
    type: 'equipment',
    category: structured.category.key,
    year: extractSimpleValue(body, 'year'),
    archetype: extractSimpleValue(body, 'archetype'),
    parent: extractSimpleValue(body, 'parent'),
    priority: extractSimpleValue(body, 'priority'),
    visual_level: extractSimpleValue(body, 'visual_level'),
    active: extractSimpleValue(body, 'active') === 'yes',
    resources_raw: extractNamedBlockBody(body, 'resources'),
    modifiers: parseTopLevelModifiers(body, RESERVED_EQUIPMENT_KEYS),
    raw: body,
    filePath,
    source: path.relative(modRoot, filePath),
    name_zh: locZh.get(block.key) || '',
    desc_zh: locZh.get(`${block.key}_desc`) || '',
    short_zh: locZh.get(`${block.key}_short`) || '',
    name_en: locEn.get(block.key) || '',
    desc_en: locEn.get(`${block.key}_desc`) || '',
    short_en: locEn.get(`${block.key}_short`) || '',
    structured,
  }
}

const loadAllTechnologies = async (locZh, locEn, refs) => {
  const files = await readAllFilesRecursive(techRoot, '.txt')
  const all = []
  for (const filePath of files) {
    let text = ''
    try {
      text = await fs.readFile(filePath, 'utf8')
    } catch {
      continue
    }
    const container = findContainerRange(text, 'technologies')
    const blocks = container
      ? parseTopLevelBlocksInRange(text, container.innerStart, container.innerEnd)
      : parseTopLevelBlocksFromBody(text)
    for (const block of blocks) {
      try {
        all.push(parseTechnologyEntry(block, filePath, locZh, locEn, refs))
      } catch {
        continue
      }
    }
  }
  return all
}

const loadAllEquipments = async (locZh, locEn, refs) => {
  const files = await readAllFilesRecursive(equipmentRoot, '.txt')
  const all = []
  for (const filePath of files) {
    let text = ''
    try {
      text = await fs.readFile(filePath, 'utf8')
    } catch {
      continue
    }
    const container = findContainerRange(text, 'equipments')
    const blocks = container
      ? parseTopLevelBlocksInRange(text, container.innerStart, container.innerEnd)
      : parseTopLevelBlocksFromBody(text)
    for (const block of blocks) {
      try {
        all.push(parseEquipmentEntry(block, filePath, locZh, locEn, refs))
      } catch {
        continue
      }
    }
  }
  const byId = new Map(all.map((item) => [item.id, item]))
  const buildChain = (startId, fieldKey) => {
    const chain = []
    const seen = new Set()
    let currentId = startId
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId)
      const node = byId.get(currentId)
      if (!node) break
      chain.push({
        id: node.id,
        name_zh: node.name_zh || '',
        name_en: node.name_en || '',
      })
      currentId = normalizeSpace(node[fieldKey])
    }
    return chain
  }
  for (const item of all) {
    const archetypeStart = normalizeSpace(item.archetype)
    const parentStart = normalizeSpace(item.parent)
    item.structured.archetype_chain = archetypeStart ? buildChain(archetypeStart, 'archetype') : []
    item.structured.parent_chain = parentStart ? buildChain(parentStart, 'parent') : []
  }
  return all
}

const ensureContainerFile = async (filePath, containerKey) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  try {
    await fs.access(filePath)
  } catch {
    await fs.writeFile(filePath, `${containerKey} = {\n}\n`, 'utf8')
  }
}

const upsertBlockToContainerFile = async ({ filePath, containerKey, id, body }) => {
  await ensureContainerFile(filePath, containerKey)
  const original = await fs.readFile(filePath, 'utf8')
  const container = findContainerRange(original, containerKey)
  if (!container) {
    throw new Error(`未找到容器 ${containerKey}: ${filePath}`)
  }
  const blocks = parseTopLevelBlocksInRange(original, container.innerStart, container.innerEnd)
  const target = blocks.find((item) => item.key === id)

  const normalizedBody = body
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n')
    .trimEnd()
  const replacement = `  ${id} = {\n${normalizedBody ? `${normalizedBody}\n` : ''}  }`

  let nextText = ''
  if (target) {
    nextText = `${original.slice(0, target.start)}${replacement}${original.slice(target.end)}`
  } else {
    const insertPos = container.innerEnd
    const prefix = original.slice(0, insertPos).replace(/\s*$/, '\n')
    const suffix = original.slice(insertPos)
    nextText = `${prefix}${replacement}\n${suffix}`
  }
  await fs.writeFile(filePath, nextText, 'utf8')
}

const escapeLoc = (value) => String(value ?? '').replace(/"/g, '\\"')

const upsertLocalizationFile = async ({ filePath, langKey, updates }) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  let text = ''
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch {
    text = ''
  }
  const normalized = text.replace(/^\uFEFF/, '')
  const lines = normalized ? normalized.split(/\r?\n/) : [`${langKey}:`]
  if (!lines[0] || !lines[0].trim().startsWith(`${langKey}:`)) {
    lines.unshift(`${langKey}:`)
  }

  const lineByKey = new Map()
  for (let i = 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*([A-Za-z0-9_.:-]+):\d*\s*".*"\s*$/)
    if (match) {
      lineByKey.set(match[1], i)
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!key) continue
    const nextLine = ` ${key}:0 "${escapeLoc(value)}"`
    if (lineByKey.has(key)) {
      lines[lineByKey.get(key)] = nextLine
    } else {
      lines.push(nextLine)
      lineByKey.set(key, lines.length - 1)
    }
  }

  const result = `\uFEFF${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
  await fs.writeFile(filePath, result, 'utf8')
}

const normalizeRaw = (raw) => {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, '  ').trimEnd())
  while (lines.length > 0 && !lines[0].trim()) lines.shift()
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop()
  return lines.join('\n')
}

const toModifierList = (input) => {
  if (!Array.isArray(input)) return []
  const result = []
  for (const item of input) {
    const key = normalizeSpace(item?.key)
    const value = normalizeSpace(item?.value)
    if (!key || !value) continue
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) continue
    result.push({ key, value })
  }
  return result
}

const filterTopLevelNumericModifierLines = (raw, reservedKeys) => {
  const lines = String(raw ?? '').split(/\r?\n/)
  const output = []
  let depth = 0
  let inString = false
  for (const line of lines) {
    const atTopLevel = depth === 0
    const pure = stripComments(line).trim()
    const match = pure.match(/^([A-Za-z0-9_.:-]+)\s*=\s*(-?\d+(?:\.\d+)?)$/)
    const shouldRemove = atTopLevel && match && !reservedKeys.has(match[1])
    if (!shouldRemove) {
      output.push(line)
    }
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '"' && line[i - 1] !== '\\') {
        inString = !inString
      } else if (!inString) {
        if (ch === '{') depth += 1
        if (ch === '}') depth = Math.max(0, depth - 1)
        if (ch === '#') break
      }
    }
  }
  return output.join('\n')
}

const applyModifiersToRaw = (raw, modifiers, reservedKeys) => {
  const nextModifiers = toModifierList(modifiers)
  const base = filterTopLevelNumericModifierLines(raw, reservedKeys).trimEnd()
  const lines = base ? [base] : []
  for (const item of nextModifiers) {
    lines.push(`${item.key} = ${item.value}`)
  }
  return lines.join('\n').trim()
}

const upsertInlineListBlock = (raw, key, value) => {
  const existing = new RegExp(`\\b${escapeRegExp(key)}\\b\\s*=\\s*\\{([^}]*)\\}`, 'm')
  if (existing.test(raw)) {
    return raw.replace(existing, (_full, inner) => {
      const list = parseWhitespaceList(inner)
      if (!list.includes(value)) {
        list.push(value)
      }
      return `${key} = { ${list.join(' ')} }`
    })
  }
  const tail = raw.trimEnd()
  return `${tail}${tail ? '\n' : ''}${key} = { ${value} }`
}

const upsertSimpleTopLevelValue = (raw, key, value) => {
  const reg = new RegExp(`(^|\\n)\\s*${escapeRegExp(key)}\\s*=\\s*[^\\n#{}]+`, 'm')
  if (reg.test(raw)) {
    return raw.replace(reg, (full, prefix) => `${prefix}${key} = ${value}`)
  }
  const tail = raw.trimEnd()
  return `${tail}${tail ? '\n' : ''}${key} = ${value}`
}

const loadSpriteNames = async () => {
  const files = await readAllFilesRecursive(interfaceRoot, '.gfx')
  const set = new Set()
  for (const filePath of files) {
    let text = ''
    try {
      text = await fs.readFile(filePath, 'utf8')
    } catch {
      continue
    }
    const matches = text.matchAll(/\bname\s*=\s*([A-Za-z0-9_.:-]+)/g)
    for (const match of matches) {
      set.add(match[1])
    }
  }
  return set
}

const buildDefaultTechRaw = (payload) => {
  const id = payload.id
  const category = normalizeSpace(payload.category || 'industry')
  const list = []
  list.push('research_cost = 1')
  list.push('start_year = 1936')
  list.push('show_equipment_icon = yes')
  list.push(`categories = { ${category} }`)
  list.push('folder = {')
  list.push('  name = infantry_folder')
  list.push('  position = { x = 0 y = 0 }')
  list.push('}')
  list.push(`# ${id} effects`)
  list.push('political_power_gain = 0')
  return list.join('\n')
}

const buildDefaultEquipmentRaw = (payload) => {
  const list = []
  list.push('year = 1936')
  list.push('active = yes')
  if (payload.archetype) {
    list.push(`archetype = ${normalizeSpace(payload.archetype)}`)
  }
  list.push('build_cost_ic = 0.5')
  list.push('reliability = 0.9')
  list.push('soft_attack = 1')
  list.push('defense = 1')
  list.push('resources = {')
  list.push('  steel = 1')
  list.push('}')
  return list.join('\n')
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    utilRoot,
    modRoot,
  })
})

app.get('/api/meta', async (_req, res) => {
  try {
    const [locZh, locEn, refs] = await Promise.all([
      loadLocalizationMap(locZhRoot),
      loadLocalizationMap(locEnRoot),
      loadReferenceContext(),
    ])
    const [techs, equipments] = await Promise.all([
      loadAllTechnologies(locZh, locEn, refs),
      loadAllEquipments(locZh, locEn, refs),
    ])
    const techCategories = Array.from(new Set(techs.map((item) => item.category))).sort()
    const equipmentCategories = Array.from(new Set(equipments.map((item) => item.category))).sort()
    res.json({
      modRoot,
      counts: {
        techs: techs.length,
        equipments: equipments.length,
      },
      techCategories,
      equipmentCategories,
      modifierHints: {
        technology: TECH_MODIFIER_HINTS,
        equipment: EQUIPMENT_MODIFIER_HINTS,
      },
      outputFiles: {
        technology: path.relative(modRoot, generatedTechFile),
        equipment: path.relative(modRoot, generatedEquipmentFile),
        locZh: path.relative(modRoot, generatedLocZhFile),
        locEn: path.relative(modRoot, generatedLocEnFile),
      },
      referenceCounts: {
        technologyCategories: refs.technologyCategories.size,
        equipmentTypes: refs.equipmentTypes.size,
      },
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/techs', async (req, res) => {
  try {
    const category = normalizeSpace(req.query.category || '')
    const keyword = normalizeSpace(req.query.q || '').toLowerCase()
    const [locZh, locEn, refs] = await Promise.all([
      loadLocalizationMap(locZhRoot),
      loadLocalizationMap(locEnRoot),
      loadReferenceContext(),
    ])
    let data = await loadAllTechnologies(locZh, locEn, refs)
    if (category && category !== 'all') {
      data = data.filter((item) => item.category === category)
    }
    if (keyword) {
      data = data.filter((item) => {
        const bag = `${item.id} ${item.name_zh} ${item.name_en} ${item.category}`.toLowerCase()
        return bag.includes(keyword)
      })
    }
    data.sort((a, b) => a.id.localeCompare(b.id))
    res.json(
      data.map((item) => ({
        id: item.id,
        category: item.category,
        source: item.source,
        name_zh: item.name_zh,
        name_en: item.name_en,
        modifiers: item.modifiers,
      })),
    )
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/techs/:id', async (req, res) => {
  try {
    const [locZh, locEn, refs] = await Promise.all([
      loadLocalizationMap(locZhRoot),
      loadLocalizationMap(locEnRoot),
      loadReferenceContext(),
    ])
    const data = await loadAllTechnologies(locZh, locEn, refs)
    const found = data.find((item) => item.id === req.params.id)
    if (!found) {
      res.status(404).json({ error: `未找到科技 ${req.params.id}` })
      return
    }
    res.json(found)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/techs/upsert', async (req, res) => {
  try {
    const payload = req.body || {}
    const id = normalizeSpace(payload.id)
    if (!id) {
      res.status(400).json({ error: '科技ID不能为空' })
      return
    }
    const filePath = normalizeSpace(payload.filePath) || generatedTechFile
    const raw = normalizeRaw(payload.raw || buildDefaultTechRaw(payload))
    const finalRaw = applyModifiersToRaw(raw, payload.modifiers, RESERVED_TECH_KEYS)
    await upsertBlockToContainerFile({
      filePath,
      containerKey: 'technologies',
      id,
      body: finalRaw,
    })

    await upsertLocalizationFile({
      filePath: generatedLocZhFile,
      langKey: 'l_simp_chinese',
      updates: {
        [id]: payload.name_zh || id,
        [`${id}_desc`]: payload.desc_zh || `${id} 描述`,
      },
    })

    await upsertLocalizationFile({
      filePath: generatedLocEnFile,
      langKey: 'l_english',
      updates: {
        [id]: payload.name_en || id,
        [`${id}_desc`]: payload.desc_en || `${id} description`,
      },
    })

    res.json({ ok: true, id, filePath: path.relative(modRoot, filePath) })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/equipments', async (req, res) => {
  try {
    const category = normalizeSpace(req.query.category || '')
    const keyword = normalizeSpace(req.query.q || '').toLowerCase()
    const [locZh, locEn, refs] = await Promise.all([
      loadLocalizationMap(locZhRoot),
      loadLocalizationMap(locEnRoot),
      loadReferenceContext(),
    ])
    let data = await loadAllEquipments(locZh, locEn, refs)
    if (category && category !== 'all') {
      data = data.filter((item) => item.category === category)
    }
    if (keyword) {
      data = data.filter((item) => {
        const bag = `${item.id} ${item.name_zh} ${item.name_en} ${item.category}`.toLowerCase()
        return bag.includes(keyword)
      })
    }
    data.sort((a, b) => a.id.localeCompare(b.id))
    res.json(
      data.map((item) => ({
        id: item.id,
        category: item.category,
        source: item.source,
        name_zh: item.name_zh,
        name_en: item.name_en,
        modifiers: item.modifiers,
      })),
    )
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/equipments/:id', async (req, res) => {
  try {
    const [locZh, locEn, refs] = await Promise.all([
      loadLocalizationMap(locZhRoot),
      loadLocalizationMap(locEnRoot),
      loadReferenceContext(),
    ])
    const data = await loadAllEquipments(locZh, locEn, refs)
    const found = data.find((item) => item.id === req.params.id)
    if (!found) {
      res.status(404).json({ error: `未找到装备 ${req.params.id}` })
      return
    }
    res.json(found)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/equipments/upsert', async (req, res) => {
  try {
    const payload = req.body || {}
    const id = normalizeSpace(payload.id)
    if (!id) {
      res.status(400).json({ error: '装备ID不能为空' })
      return
    }
    const filePath = normalizeSpace(payload.filePath) || generatedEquipmentFile
    const raw = normalizeRaw(payload.raw || buildDefaultEquipmentRaw(payload))
    const finalRaw = applyModifiersToRaw(raw, payload.modifiers, RESERVED_EQUIPMENT_KEYS)
    await upsertBlockToContainerFile({
      filePath,
      containerKey: 'equipments',
      id,
      body: finalRaw,
    })

    await upsertLocalizationFile({
      filePath: generatedLocZhFile,
      langKey: 'l_simp_chinese',
      updates: {
        [id]: payload.name_zh || id,
        [`${id}_short`]: payload.short_zh || payload.name_zh || id,
        [`${id}_desc`]: payload.desc_zh || `${id} 描述`,
      },
    })

    await upsertLocalizationFile({
      filePath: generatedLocEnFile,
      langKey: 'l_english',
      updates: {
        [id]: payload.name_en || id,
        [`${id}_short`]: payload.short_en || payload.name_en || id,
        [`${id}_desc`]: payload.desc_en || `${id} description`,
      },
    })

    res.json({ ok: true, id, filePath: path.relative(modRoot, filePath) })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/raw/apply-modifiers', async (req, res) => {
  try {
    const payload = req.body || {}
    const type = payload.type === 'equipment' ? 'equipment' : 'technology'
    const raw = normalizeRaw(payload.raw || '')
    const modifiers = toModifierList(payload.modifiers)
    const reserved = type === 'technology' ? RESERVED_TECH_KEYS : RESERVED_EQUIPMENT_KEYS
    const mergedRaw = applyModifiersToRaw(raw, modifiers, reserved)
    res.json({ ok: true, raw: mergedRaw, modifiers: parseTopLevelModifiers(mergedRaw, reserved) })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/techs/:id/link-equipment', async (req, res) => {
  try {
    const techId = normalizeSpace(req.params.id)
    const equipmentId = normalizeSpace(req.body?.equipmentId)
    const autoFixLocalization = req.body?.autoFixLocalization !== false
    if (!techId || !equipmentId) {
      res.status(400).json({ error: '科技ID与装备ID不能为空' })
      return
    }

    const [locZh, locEn, sprites, refs] = await Promise.all([
      loadLocalizationMap(locZhRoot),
      loadLocalizationMap(locEnRoot),
      loadSpriteNames(),
      loadReferenceContext(),
    ])
    const [techs, equipments] = await Promise.all([
      loadAllTechnologies(locZh, locEn, refs),
      loadAllEquipments(locZh, locEn, refs),
    ])
    const tech = techs.find((item) => item.id === techId)
    if (!tech) {
      res.status(404).json({ error: `未找到科技 ${techId}` })
      return
    }
    const equipment = equipments.find((item) => item.id === equipmentId)
    if (!equipment) {
      res.status(404).json({ error: `未找到装备 ${equipmentId}` })
      return
    }

    const checksBefore = {
      enable_equipments_linked: tech.enable_equipments.includes(equipmentId),
      show_equipment_icon: tech.show_equipment_icon,
      tech_icon_exists: sprites.has(`GFX_${techId}_medium`),
      equipment_icon_exists: sprites.has(`GFX_${equipmentId}_medium`),
      loc_zh_tech_name: Boolean(locZh.get(techId)),
      loc_zh_tech_desc: Boolean(locZh.get(`${techId}_desc`)),
      loc_en_tech_name: Boolean(locEn.get(techId)),
      loc_en_tech_desc: Boolean(locEn.get(`${techId}_desc`)),
      loc_zh_equipment_name: Boolean(locZh.get(equipmentId)),
      loc_zh_equipment_desc: Boolean(locZh.get(`${equipmentId}_desc`)),
      loc_zh_equipment_short: Boolean(locZh.get(`${equipmentId}_short`)),
      loc_en_equipment_name: Boolean(locEn.get(equipmentId)),
      loc_en_equipment_desc: Boolean(locEn.get(`${equipmentId}_desc`)),
      loc_en_equipment_short: Boolean(locEn.get(`${equipmentId}_short`)),
    }

    let nextRaw = upsertInlineListBlock(tech.raw, 'enable_equipments', equipmentId)
    nextRaw = upsertSimpleTopLevelValue(nextRaw, 'show_equipment_icon', 'yes')
    await upsertBlockToContainerFile({
      filePath: tech.filePath,
      containerKey: 'technologies',
      id: techId,
      body: nextRaw,
    })

    if (autoFixLocalization) {
      const zhTechName = tech.name_zh || techId
      const zhTechDesc = tech.desc_zh || `${techId} 描述`
      const enTechName = tech.name_en || techId
      const enTechDesc = tech.desc_en || `${techId} description`
      const zhEqName = equipment.name_zh || equipmentId
      const zhEqDesc = equipment.desc_zh || `${equipmentId} 描述`
      const zhEqShort = equipment.short_zh || equipment.name_zh || equipmentId
      const enEqName = equipment.name_en || equipmentId
      const enEqDesc = equipment.desc_en || `${equipmentId} description`
      const enEqShort = equipment.short_en || equipment.name_en || equipmentId
      await upsertLocalizationFile({
        filePath: generatedLocZhFile,
        langKey: 'l_simp_chinese',
        updates: {
          [techId]: zhTechName,
          [`${techId}_desc`]: zhTechDesc,
          [equipmentId]: zhEqName,
          [`${equipmentId}_short`]: zhEqShort,
          [`${equipmentId}_desc`]: zhEqDesc,
        },
      })
      await upsertLocalizationFile({
        filePath: generatedLocEnFile,
        langKey: 'l_english',
        updates: {
          [techId]: enTechName,
          [`${techId}_desc`]: enTechDesc,
          [equipmentId]: enEqName,
          [`${equipmentId}_short`]: enEqShort,
          [`${equipmentId}_desc`]: enEqDesc,
        },
      })
    }

    const [locZhAfter, locEnAfter] = await Promise.all([loadLocalizationMap(locZhRoot), loadLocalizationMap(locEnRoot)])
    const checksAfter = {
      enable_equipments_linked: true,
      show_equipment_icon: true,
      tech_icon_exists: sprites.has(`GFX_${techId}_medium`),
      equipment_icon_exists: sprites.has(`GFX_${equipmentId}_medium`),
      loc_zh_tech_name: Boolean(locZhAfter.get(techId)),
      loc_zh_tech_desc: Boolean(locZhAfter.get(`${techId}_desc`)),
      loc_en_tech_name: Boolean(locEnAfter.get(techId)),
      loc_en_tech_desc: Boolean(locEnAfter.get(`${techId}_desc`)),
      loc_zh_equipment_name: Boolean(locZhAfter.get(equipmentId)),
      loc_zh_equipment_desc: Boolean(locZhAfter.get(`${equipmentId}_desc`)),
      loc_zh_equipment_short: Boolean(locZhAfter.get(`${equipmentId}_short`)),
      loc_en_equipment_name: Boolean(locEnAfter.get(equipmentId)),
      loc_en_equipment_desc: Boolean(locEnAfter.get(`${equipmentId}_desc`)),
      loc_en_equipment_short: Boolean(locEnAfter.get(`${equipmentId}_short`)),
    }

    res.json({
      ok: true,
      techId,
      equipmentId,
      checksBefore,
      checksAfter,
      note: '已自动补全 enable_equipments 与 show_equipment_icon，图标仅做存在性检查。',
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

const port = Number(process.env.PORT || 5189)
app.listen(port, () => {
  console.log(`[util-tech] server listening on ${port}`)
})
