import cors from 'cors'
import { decodeDds, parseHeaders } from 'dds-parser'
import express from 'express'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const utilRoot = path.resolve(__dirname, '..')
const modRoot = path.resolve(utilRoot, '..')
const userRoot = path.resolve(modRoot, '..', '..')
const gameRoot = path.resolve(userRoot, '..', 'Hearts of Iron IV')
const traitReferences = [
  path.resolve(userRoot, '..', '基础代码', '代码提词器', '钢4人物trait分类参考.txt'),
  path.resolve(userRoot, '..', '基础代码', '代码提词器', '部分内阁特质提词器.txt'),
]

const app = express()
app.use(cors())
app.use(express.json({ limit: '20mb' }))
let characterDefinitionsCache = null
let spriteMapCache = null
let spriteFilesCache = null
let spriteIndexCache = null
let localizationMapCache = null
let localizationFilesCache = null
let portraitLookupCache = null
let recruitIdsByTagCache = null
let characterFileIndexCache = null
const spriteIndexPath = path.join(utilRoot, '.cache', 'sprite_index.json')
const defaultPortraitWidth = 156
const defaultPortraitHeight = 210

const stripComments = (text) => text.replace(/#.*$/gm, '')
const browserImageExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
const supportedPortraitExt = new Set(['.dds', ...browserImageExt])

const buildFallbackSvg = (label) => {
  const safe = String(label ?? 'NO IMAGE').slice(0, 28)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="156" height="210" viewBox="0 0 156 210">
<rect width="156" height="210" fill="#0f172a"/>
<rect x="6" y="6" width="144" height="198" fill="#1e293b" stroke="#334155" stroke-width="2"/>
<text x="78" y="90" text-anchor="middle" fill="#67e8f9" font-family="Segoe UI, sans-serif" font-size="14">Portrait</text>
<text x="78" y="112" text-anchor="middle" fill="#94a3b8" font-family="Segoe UI, sans-serif" font-size="10">${safe}</text>
</svg>`
}

const findBlockRangeByKey = (text, key) => {
  const marker = `${key}`
  const start = text.search(new RegExp(`\\b${marker}\\b\\s*=`))
  if (start === -1) {
    return null
  }
  const braceStart = text.indexOf('{', start)
  if (braceStart === -1) {
    return null
  }
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
    }
    i += 1
  }
  if (depth !== 0) {
    return null
  }
  return { start, end: i }
}

const extractMaskedChannel = (value, mask) => {
  if (!mask) {
    return 0
  }
  let shift = 0
  let working = mask >>> 0
  while ((working & 1) === 0 && shift < 32) {
    working >>>= 1
    shift += 1
  }
  const max = working >>> 0
  if (!max) {
    return 0
  }
  const channel = ((value & mask) >>> shift) >>> 0
  return Math.round((channel * 255) / max)
}

const decodeRawRgbDds = (ddsBuffer) => {
  const dv = new DataView(ddsBuffer.buffer, ddsBuffer.byteOffset, ddsBuffer.byteLength)
  const u32 = (offset) => dv.getUint32(offset, true)
  const magic = ddsBuffer.subarray(0, 4).toString('ascii')
  if (magic !== 'DDS ') {
    throw new Error('invalid dds magic')
  }
  const height = u32(12)
  const width = u32(16)
  const pitch = u32(20)
  const pixelFormatFlags = u32(80)
  const fourCC = u32(84)
  const rgbBitCount = u32(88)
  const rMask = u32(92)
  const gMask = u32(96)
  const bMask = u32(100)
  const aMask = u32(104)
  const hasRgb = (pixelFormatFlags & 0x40) !== 0
  if (!hasRgb || fourCC !== 0) {
    throw new Error('not raw rgb dds')
  }
  const bytesPerPixel = Math.ceil(rgbBitCount / 8)
  if (![3, 4].includes(bytesPerPixel)) {
    throw new Error(`unsupported rgb bit count: ${rgbBitCount}`)
  }
  const rowStride = pitch || width * bytesPerPixel
  const dataOffset = 128
  if (ddsBuffer.byteLength < dataOffset + rowStride * height) {
    throw new Error('dds data truncated')
  }
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const srcRowStart = dataOffset + y * rowStride
    for (let x = 0; x < width; x += 1) {
      const srcOffset = srcRowStart + x * bytesPerPixel
      let value = 0
      for (let i = 0; i < bytesPerPixel; i += 1) {
        value |= ddsBuffer[srcOffset + i] << (8 * i)
      }
      const outOffset = (y * width + x) * 4
      rgba[outOffset] = extractMaskedChannel(value, rMask)
      rgba[outOffset + 1] = extractMaskedChannel(value, gMask)
      rgba[outOffset + 2] = extractMaskedChannel(value, bMask)
      rgba[outOffset + 3] = aMask ? extractMaskedChannel(value, aMask) : 255
    }
  }
  return { width, height, rgba }
}

const decodeDdsToImage = (ddsBuffer) => {
  try {
    const ddsArrayBuffer = ddsBuffer.buffer.slice(
      ddsBuffer.byteOffset,
      ddsBuffer.byteOffset + ddsBuffer.byteLength,
    )
    const ddsInfo = parseHeaders(ddsArrayBuffer)
    const image = ddsInfo.images?.[0]
    const format = ddsInfo.format
    if (image && format && ['dxt1', 'dxt3', 'dxt5', 'ati2'].includes(format)) {
      const source = ddsBuffer.subarray(image.offset, image.offset + image.length)
      const rgba = decodeDds(
        source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
        format,
        image.shape.width,
        image.shape.height,
      )
      return {
        width: image.shape.width,
        height: image.shape.height,
        rgba: Buffer.from(rgba),
      }
    }
  } catch {
    return decodeRawRgbDds(ddsBuffer)
  }
  return decodeRawRgbDds(ddsBuffer)
}

const findBlocksByKey = (text, key) => {
  const source = stripComments(text)
  const blocks = []
  const marker = `${key}`
  let cursor = 0
  while (cursor < source.length) {
    const start = source.indexOf(marker, cursor)
    if (start === -1) {
      break
    }
    const afterKey = source.slice(start + marker.length)
    const equalOffset = afterKey.search(/^\s*=/)
    if (equalOffset === -1) {
      cursor = start + marker.length
      continue
    }
    const eqIndex = start + marker.length + equalOffset
    const braceIndex = source.indexOf('{', eqIndex)
    if (braceIndex === -1) {
      cursor = eqIndex + 1
      continue
    }
    let i = braceIndex + 1
    let depth = 1
    let inString = false
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '"' && source[i - 1] !== '\\') {
        inString = !inString
      } else if (!inString) {
        if (ch === '{') depth += 1
        if (ch === '}') depth -= 1
      }
      i += 1
    }
    if (depth === 0) {
      const content = source.slice(braceIndex + 1, i - 1)
      blocks.push({ start: braceIndex, end: i, content })
      cursor = i
    } else {
      break
    }
  }
  return blocks
}

const findCharacterDefinitions = (text) => {
  const characterBlocks = findBlocksByKey(text, 'characters')
  const list = []
  for (const block of characterBlocks) {
    const content = block.content
    const re = /([A-Za-z0-9_]+)\s*=\s*\{/g
    let match
    while ((match = re.exec(content))) {
      const id = match[1]
      const braceStart = match.index + match[0].lastIndexOf('{')
      let i = braceStart + 1
      let depth = 1
      let inString = false
      while (i < content.length && depth > 0) {
        const ch = content[i]
        if (ch === '"' && content[i - 1] !== '\\') {
          inString = !inString
        } else if (!inString) {
          if (ch === '{') depth += 1
          if (ch === '}') depth -= 1
        }
        i += 1
      }
      if (depth === 0) {
        const body = content.slice(braceStart + 1, i - 1)
        list.push({ id, body })
        re.lastIndex = i
      }
    }
  }
  return list
}

const firstMatch = (text, regex) => {
  const match = regex.exec(text)
  if (!match) {
    return null
  }
  return match[1] ?? match[2] ?? null
}

const normalizeToken = (value) => {
  if (!value) return ''
  return value.replace(/^"|"$/g, '')
}

const parseCharacterTypes = (body) => {
  const types = []
  if (/\badvisor\s*=/.test(body)) types.push('advisor')
  if (/\bcountry_leader\s*=/.test(body)) types.push('country_leader')
  if (/\bcorps_commander\s*=/.test(body)) types.push('corps_commander')
  if (/\bfield_marshal\s*=/.test(body)) types.push('field_marshal')
  if (/\bnavy_leader\s*=/.test(body)) types.push('navy_leader')
  if (!types.length) types.push('character')
  return types
}

const parseTraitsBlocks = (body) => {
  const matches = [...body.matchAll(/\btraits\s*=\s*\{([^}]*)\}/g)]
  return matches.map((match, index) => {
    const traits = (match[1].match(/[A-Za-z0-9_]+/g) ?? []).filter((item) => item !== 'traits')
    return { index, traits, raw: match[0] }
  })
}

const parseDescriptionToken = (body) =>
  normalizeToken(firstMatch(body, /\bdesc\s*=\s*("([^"]+)"|([^\s{}#]+))/))

const parsePortraitSprite = (body) => {
  const portraitsBlock = findBlocksByKey(body, 'portraits')[0]
  if (!portraitsBlock) return null
  const content = portraitsBlock.content
  const keys = [
    /civilian\s*=\s*\{[\s\S]*?\blarge\s*=\s*([A-Za-z0-9_]+)/,
    /army\s*=\s*\{[\s\S]*?\blarge\s*=\s*([A-Za-z0-9_]+)/,
    /navy\s*=\s*\{[\s\S]*?\blarge\s*=\s*([A-Za-z0-9_]+)/,
    /civilian\s*=\s*\{[\s\S]*?\bsmall\s*=\s*([A-Za-z0-9_]+)/,
    /army\s*=\s*\{[\s\S]*?\bsmall\s*=\s*([A-Za-z0-9_]+)/,
    /navy\s*=\s*\{[\s\S]*?\bsmall\s*=\s*([A-Za-z0-9_]+)/,
    /\bsmall\s*=\s*([A-Za-z0-9_]+)/,
  ]
  for (const re of keys) {
    const match = content.match(re)
    if (match) {
      return match[1]
    }
  }
  return null
}

const parseSmallPortraitSprite = (body) => {
  const portraitsBlock = findBlocksByKey(body, 'portraits')[0]
  if (!portraitsBlock) return null
  const content = portraitsBlock.content
  const keys = [
    /civilian\s*=\s*\{[\s\S]*?\bsmall\s*=\s*(?:"([^"]+)"|([A-Za-z0-9_]+))/,
    /army\s*=\s*\{[\s\S]*?\bsmall\s*=\s*(?:"([^"]+)"|([A-Za-z0-9_]+))/,
    /navy\s*=\s*\{[\s\S]*?\bsmall\s*=\s*(?:"([^"]+)"|([A-Za-z0-9_]+))/,
    /\bsmall\s*=\s*(?:"([^"]+)"|([A-Za-z0-9_]+))/,
  ]
  for (const re of keys) {
    const match = content.match(re)
    if (match) {
      return match[1] ?? match[2]
    }
  }
  return null
}

const parseDisplayPortraitSprite = (body, types = []) => {
  if (types.includes('advisor')) {
    return parseSmallPortraitSprite(body) || parsePortraitSprite(body)
  }
  return parsePortraitSprite(body)
}

const toBrowserFriendlyPortraitPath = async (rawPath) => {
  if (!rawPath) {
    return null
  }
  const ext = path.extname(rawPath).toLowerCase()
  if (browserImageExt.has(ext) && (await exists(rawPath))) {
    return rawPath
  }
  const base = rawPath.slice(0, -ext.length)
  for (const candidateExt of browserImageExt) {
    const candidate = `${base}${candidateExt}`
    if (await exists(candidate)) {
      return candidate
    }
  }
  if (supportedPortraitExt.has(ext) && (await exists(rawPath))) {
    return rawPath
  }
  return null
}

const exists = async (targetPath) => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

const readAllFiles = async (folderPath, extensions = ['.txt']) => {
  if (!(await exists(folderPath))) {
    return []
  }
  const entries = await fs.readdir(folderPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await readAllFiles(fullPath, extensions)))
      continue
    }
    if (extensions.includes(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath)
    }
  }
  return files
}

const extractTag = (fileName) => {
  const match = fileName.match(/^([A-Z0-9]{2,4})\b/)
  return match ? match[1] : null
}

const loadLocalizationFiles = async (reload = false) => {
  if (reload) {
    localizationFilesCache = null
  }
  if (localizationFilesCache) {
    return localizationFilesCache
  }
  const targets = [
    path.join(modRoot, 'localisation', 'simp_chinese'),
    path.join(modRoot, 'localisation', 'english'),
  ]
  const files = []
  for (const target of targets) {
    files.push(...(await readAllFiles(target, ['.yml', '.yaml'])))
  }
  localizationFilesCache = files
  return files
}

const loadLocalizationValues = async (keys, reload = false) => {
  if (reload || !localizationMapCache) {
    localizationMapCache = new Map()
  }
  const wanted = [...new Set(keys.filter(Boolean))]
  const missing = wanted.filter((key) => !localizationMapCache.has(key))
  if (missing.length > 0) {
    const unresolved = new Set(missing)
    const files = await loadLocalizationFiles(reload)
    for (const filePath of files) {
      if (unresolved.size === 0) {
        break
      }
      let text = ''
      try {
        text = await fs.readFile(filePath, 'utf8')
      } catch {
        continue
      }
      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/^\s*([^\s:#]+):\d*\s*"([^"]*)"/)
        if (!match) {
          continue
        }
        const key = match[1]
        if (unresolved.has(key)) {
          localizationMapCache.set(key, match[2])
          unresolved.delete(key)
          if (unresolved.size === 0) {
            break
          }
        }
      }
    }
    for (const key of unresolved) {
      localizationMapCache.set(key, null)
    }
  }
  const result = new Map()
  for (const key of wanted) {
    result.set(key, localizationMapCache.get(key))
  }
  return result
}

const loadSpriteFiles = async (reload = false) => {
  if (reload) {
    spriteFilesCache = null
  }
  if (spriteFilesCache) {
    return spriteFilesCache
  }
  const interfaceDirs = [
    path.join(modRoot, 'interface'),
    path.join(gameRoot, 'interface'),
  ]
  const files = []
  for (const folder of interfaceDirs) {
    files.push(...(await readAllFiles(folder, ['.gfx'])))
  }
  spriteFilesCache = files
  return files
}

const parseSpriteTypesFromText = (text) => {
  const sprites = {}
  const re = /spriteType\s*=\s*\{[\s\S]*?\bname\s*=\s*(?:"([^"]+)"|([^\s{}]+))[\s\S]*?\btexturefile\s*=\s*(?:"([^"]+)"|([^\s{}]+))/g
  let match
  while ((match = re.exec(text))) {
    const name = match[1] ?? match[2]
    const texturePath = (match[3] ?? match[4]).replaceAll('/', path.sep)
    if (!(name in sprites)) {
      sprites[name] = texturePath
    }
  }
  return sprites
}

const loadSpriteIndex = async () => {
  if (spriteIndexCache) {
    return spriteIndexCache
  }
  try {
    const raw = await fs.readFile(spriteIndexPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && parsed.version === 1 && parsed.files && typeof parsed.files === 'object') {
      spriteIndexCache = parsed
      return spriteIndexCache
    }
  } catch {
    spriteIndexCache = null
  }
  spriteIndexCache = { version: 1, files: {} }
  return spriteIndexCache
}

const saveSpriteIndex = async () => {
  if (!spriteIndexCache) {
    return
  }
  await fs.mkdir(path.dirname(spriteIndexPath), { recursive: true })
  await fs.writeFile(spriteIndexPath, JSON.stringify(spriteIndexCache), 'utf8')
}

const loadSpriteValues = async (names, reload = false) => {
  if (reload || !spriteMapCache) {
    spriteMapCache = new Map()
  }
  if (reload) {
    spriteIndexCache = null
  }
  const wanted = [...new Set(names.filter(Boolean))]
  const missing = wanted.filter((name) => !spriteMapCache.has(name))
  if (missing.length > 0) {
    const unresolved = new Set(missing)
    const files = await loadSpriteFiles(reload)
    const index = await loadSpriteIndex()
    const alive = new Set(files)
    let indexChanged = false
    for (const key of Object.keys(index.files)) {
      if (!alive.has(key)) {
        delete index.files[key]
        indexChanged = true
      }
    }
    for (const filePath of files) {
      if (unresolved.size === 0) {
        break
      }
      let mtimeMs = 0
      try {
        const stat = await fs.stat(filePath)
        mtimeMs = stat.mtimeMs
      } catch {
        continue
      }
      let sprites = index.files[filePath]?.sprites
      if (!sprites || index.files[filePath]?.mtimeMs !== mtimeMs) {
        let text = ''
        try {
          text = await fs.readFile(filePath, 'utf8')
        } catch {
          continue
        }
        sprites = parseSpriteTypesFromText(text)
        index.files[filePath] = { mtimeMs, sprites }
        indexChanged = true
      }
      for (const [name, texturePath] of Object.entries(sprites)) {
        if (!unresolved.has(name)) {
          continue
        }
        spriteMapCache.set(name, texturePath)
        unresolved.delete(name)
        if (unresolved.size === 0) {
          break
        }
      }
    }
    if (indexChanged) {
      await saveSpriteIndex()
    }
    for (const name of unresolved) {
      spriteMapCache.set(name, null)
    }
  }
  const result = new Map()
  for (const name of wanted) {
    result.set(name, spriteMapCache.get(name))
  }
  return result
}

const loadTraitReference = async () => {
  const traits = new Map()
  for (const filePath of traitReferences) {
    let text = ''
    try {
      text = await fs.readFile(filePath, 'utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      const pure = line.trim()
      if (!pure || pure.startsWith('-') || pure.startsWith('#') || pure.startsWith('(')) {
        continue
      }
      const match = pure.match(/^([A-Za-z0-9_]+)\s+(.+)$/)
      if (!match) {
        continue
      }
      if (!traits.has(match[1])) {
        traits.set(match[1], { id: match[1], text: match[2].trim() })
      }
    }
  }
  return [...traits.values()]
}

const findCountryHistoryFile = async (tag, preferMod = true) => {
  const candidates = []
  const roots = preferMod
    ? [path.join(modRoot, 'history', 'countries'), path.join(gameRoot, 'history', 'countries')]
    : [path.join(gameRoot, 'history', 'countries'), path.join(modRoot, 'history', 'countries')]
  for (const root of roots) {
    if (!(await exists(root))) continue
    const files = await fs.readdir(root)
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.txt')) continue
      const currentTag = extractTag(file)
      if (currentTag === tag) {
        candidates.push(path.join(root, file))
      }
    }
  }
  return candidates[0] ?? null
}

const loadCharacterDefinitions = async (reload = false) => {
  if (reload) {
    characterDefinitionsCache = null
  }
  if (characterDefinitionsCache) {
    return characterDefinitionsCache
  }
  const commonDirs = [
    path.join(modRoot, 'common', 'characters'),
    path.join(gameRoot, 'common', 'characters'),
  ]
  const definitions = new Map()
  for (const folder of commonDirs) {
    const files = await readAllFiles(folder, ['.txt'])
    for (const filePath of files) {
      const base = path.basename(filePath).toLowerCase()
      if (base.includes('portrait_overrides') || base.includes('trait_overrides')) {
        continue
      }
      const text = await fs.readFile(filePath, 'utf8')
      const chars = findCharacterDefinitions(text)
      for (const character of chars) {
        if (!definitions.has(character.id)) {
          const nameToken = normalizeToken(firstMatch(character.body, /\bname\s*=\s*("([^"]+)"|([^\s{}#]+))/))
          const localizedName = nameToken || character.id
          const descToken = parseDescriptionToken(character.body)
          const types = parseCharacterTypes(character.body)
          const portraitSprite = parseDisplayPortraitSprite(character.body, types)
          definitions.set(character.id, {
            id: character.id,
            nameToken,
            descToken,
            localizedName,
            types,
            portraitSprite,
            portraitPath: null,
            body: character.body,
            traitsBlocks: parseTraitsBlocks(character.body),
          })
        }
      }
    }
  }
  characterDefinitionsCache = definitions
  return definitions
}

const loadCharacterDefinitionsByIds = async (ids, reload = false) => {
  if (reload) {
    characterDefinitionsCache = null
  }
  if (!characterDefinitionsCache) {
    characterDefinitionsCache = new Map()
  }
  const missing = [...new Set(ids.filter(Boolean))].filter((id) => !characterDefinitionsCache.has(id))
  if (missing.length === 0) {
    return characterDefinitionsCache
  }
  const wanted = new Set(ids.filter(Boolean))
  const pending = new Set(missing)
  const wantedTags = new Set(
    [...wanted]
      .map((id) => {
        const m = String(id).match(/^([A-Z0-9]{2,4})_/)
        return m ? m[1] : ''
      })
      .filter(Boolean),
  )
  const commonDirs = [
    path.join(modRoot, 'common', 'characters'),
    path.join(gameRoot, 'common', 'characters'),
  ]
  for (const folder of commonDirs) {
    const files = await readAllFiles(folder, ['.txt'])
    for (const filePath of files) {
      const lowerBaseName = path.basename(filePath).toLowerCase()
      if (lowerBaseName.includes('portrait_overrides') || lowerBaseName.includes('trait_overrides')) {
        continue
      }
      const baseName = path.basename(filePath).toUpperCase()
      const likelyTagFile =
        baseName.startsWith('PW_CHARACTER_EDITOR_') ||
        wantedTags.size === 0 ||
        [...wantedTags].some(
          (tag) =>
            baseName.startsWith(`${tag} `) ||
            baseName.startsWith(`${tag}_`) ||
            baseName.startsWith(`${tag}-`) ||
            baseName.includes(` ${tag} `) ||
            baseName.includes(`_${tag}_`) ||
            baseName.includes(`-${tag}-`),
        )
      if (!likelyTagFile && pending.size > 0) {
        continue
      }
      if (pending.size === 0) {
        continue
      }
      const text = await fs.readFile(filePath, 'utf8')
      const chars = findCharacterDefinitions(text)
      for (const character of chars) {
        if (!wanted.has(character.id)) {
          continue
        }
        if (characterDefinitionsCache.has(character.id)) {
          continue
        }
        const nameToken = normalizeToken(firstMatch(character.body, /\bname\s*=\s*("([^"]+)"|([^\s{}#]+))/))
        const localizedName = nameToken || character.id
        const descToken = parseDescriptionToken(character.body)
        const types = parseCharacterTypes(character.body)
        const portraitSprite = parseDisplayPortraitSprite(character.body, types)
        characterDefinitionsCache.set(character.id, {
          id: character.id,
          nameToken,
          descToken,
          localizedName,
          types,
          portraitSprite,
          portraitPath: null,
          body: character.body,
          traitsBlocks: parseTraitsBlocks(character.body),
        })
        pending.delete(character.id)
      }
    }
  }
  return characterDefinitionsCache
}

const resolvePortraitFromTexture = async (texturePath) => {
  if (!texturePath) {
    return { portraitPath: null, portraitVersion: null }
  }
  if (!portraitLookupCache) {
    portraitLookupCache = new Map()
  }
  if (portraitLookupCache.has(texturePath)) {
    return portraitLookupCache.get(texturePath)
  }
  const fallback = { portraitPath: null, portraitVersion: null }
  for (const root of [modRoot, gameRoot]) {
    const candidate = path.resolve(root, texturePath)
    if (!(await exists(candidate))) {
      continue
    }
    const portraitPath = await toBrowserFriendlyPortraitPath(candidate)
    let portraitVersion = null
    try {
      const stat = await fs.stat(candidate)
      portraitVersion = stat.mtimeMs
    } catch {
      portraitVersion = null
    }
    const resolved = { portraitPath, portraitVersion }
    portraitLookupCache.set(texturePath, resolved)
    return resolved
  }
  portraitLookupCache.set(texturePath, fallback)
  return fallback
}

const loadRecruitIdsByTag = async (tag) => {
  if (!recruitIdsByTagCache) {
    recruitIdsByTagCache = new Map()
  }
  const historyFile = await findCountryHistoryFile(tag, true)
  if (!historyFile) {
    return []
  }
  let mtimeMs = 0
  try {
    const stat = await fs.stat(historyFile)
    mtimeMs = stat.mtimeMs
  } catch {
    mtimeMs = 0
  }
  const cached = recruitIdsByTagCache.get(tag)
  if (cached && cached.historyFile === historyFile && cached.mtimeMs === mtimeMs) {
    return cached.ids
  }
  const historyText = await fs.readFile(historyFile, 'utf8')
  const ids = [...new Set([...historyText.matchAll(/\brecruit_character\s*=\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]))]
  recruitIdsByTagCache.set(tag, {
    historyFile,
    mtimeMs,
    ids,
  })
  return ids
}

const loadCharacterBaseListByTag = async (tag) => {
  const uniqueIds = await loadRecruitIdsByTag(tag)
  const definitions =
    uniqueIds.length > 0
      ? await loadCharacterDefinitionsByIds(uniqueIds, false)
      : await loadCharacterDefinitions(false)
  return uniqueIds.length > 0
    ? uniqueIds.map((id) => definitions.get(id)).filter(Boolean)
    : [...definitions.values()]
        .filter((item) => item.id.toUpperCase().startsWith(`${tag.toUpperCase()}_`))
        .sort((a, b) => a.id.localeCompare(b.id))
}

const readCharacterListByTag = async (tag) => {
  const baseList = await loadCharacterBaseListByTag(tag)
  const localizationKeys = baseList.map((item) => item.nameToken).filter(Boolean)
  const localizationMap = await loadLocalizationValues(localizationKeys, false)
  return baseList.map((item) => ({
    id: item.id,
    nameToken: item.nameToken,
    localizedName: localizationMap.get(item.nameToken) ?? item.nameToken ?? item.id,
    types: item.types,
    portraitUrl: null,
  }))
}

const readCharacterDetail = async (tag, characterId, includePortrait = false) => {
  const recruitIds = await loadRecruitIdsByTag(tag)
  if (recruitIds.length > 0 && !recruitIds.includes(characterId)) {
    return null
  }
  const definitions = await loadCharacterDefinitionsByIds([characterId], false)
  const item = definitions.get(characterId)
  if (!item) {
    return null
  }
  const localizationKeys = [item.nameToken, item.descToken].filter(Boolean)
  const localizationMap = await loadLocalizationValues(localizationKeys, false)
  let portraitPath = null
  let portraitVersion = null
  if (includePortrait) {
    const spriteNames = item.portraitSprite ? [item.portraitSprite] : []
    const spriteMap = await loadSpriteValues(spriteNames, false)
    const texturePath = item.portraitSprite ? spriteMap.get(item.portraitSprite) : null
    const resolved = await resolvePortraitFromTexture(texturePath)
    portraitPath = resolved.portraitPath
    portraitVersion = resolved.portraitVersion
  }
  return {
    ...item,
    localizedName: localizationMap.get(item.nameToken) ?? item.nameToken ?? item.id,
    localizedDescription: item.descToken ? localizationMap.get(item.descToken) ?? item.descToken : '',
    portraitPath,
    portraitVersion,
  }
}

const resolveCharacterPortraitTarget = async (characterId) => {
  const definitions = await loadCharacterDefinitionsByIds([characterId], false)
  const character = definitions.get(characterId)
  const spriteName = (character ? parsePortraitSprite(character.body) : null) || character?.portraitSprite
  if (!spriteName) {
    return null
  }
  const spriteMap = await loadSpriteValues([spriteName], false)
  const texturePath = spriteMap.get(spriteName)
  if (!texturePath) {
    return null
  }
  const absoluteTarget = path.resolve(modRoot, texturePath)
  return {
    character,
    spriteName,
    texturePath,
    absoluteTarget,
  }
}

const resolveCharacterIdeaTarget = async (characterId, character) => {
  if (!character?.types?.includes('advisor')) {
    return null
  }
  const largeSpriteName = parsePortraitSprite(character.body)
  const fallbackSpriteName = `GFX_Idea_${characterId}`
  let spriteName = parseSmallPortraitSprite(character.body) || fallbackSpriteName
  const spriteMap = await loadSpriteValues([spriteName, largeSpriteName].filter(Boolean), false)
  let texturePath = spriteMap.get(spriteName) || path.join('gfx', 'interface', 'ideas', `Idea_${characterId}.dds`)
  const largeTexturePath = largeSpriteName ? spriteMap.get(largeSpriteName) : null
  let needsRewire = false
  if (!spriteName || (largeSpriteName && spriteName === largeSpriteName) || (largeTexturePath && texturePath === largeTexturePath)) {
    spriteName = fallbackSpriteName
    texturePath = path.join('gfx', 'interface', 'ideas', `Idea_${characterId}.dds`)
    needsRewire = true
  }
  const absoluteTarget = path.resolve(modRoot, texturePath)
  return {
    spriteName,
    texturePath,
    absoluteTarget,
    needsRewire,
  }
}

const writePortraitDataToTarget = async ({ targetPath, imageDataUrl, ddsBase64 }) => {
  const readImageByPath = async (imagePath) => {
    const ext = path.extname(imagePath).toLowerCase()
    if (ext === '.dds') {
      const ddsBuffer = await fs.readFile(imagePath)
      const decodedImage = decodeDdsToImage(ddsBuffer)
      return { width: decodedImage.width, height: decodedImage.height, rgba: decodedImage.rgba }
    }
    if (ext === '.png') {
      const pngBuffer = await fs.readFile(imagePath)
      const parsed = PNG.sync.read(pngBuffer)
      return { width: parsed.width, height: parsed.height, rgba: parsed.data }
    }
    return null
  }
  const fitContainRgba = ({ srcWidth, srcHeight, srcRgba, dstWidth, dstHeight }) => {
    const out = Buffer.alloc(dstWidth * dstHeight * 4, 0)
    const scale = Math.min(dstWidth / srcWidth, dstHeight / srcHeight)
    const scaledWidth = Math.max(1, Math.round(srcWidth * scale))
    const scaledHeight = Math.max(1, Math.round(srcHeight * scale))
    const offsetX = Math.floor((dstWidth - scaledWidth) / 2)
    const offsetY = Math.floor((dstHeight - scaledHeight) / 2)
    for (let y = 0; y < scaledHeight; y += 1) {
      const sy = Math.min(srcHeight - 1, Math.floor((y / scaledHeight) * srcHeight))
      for (let x = 0; x < scaledWidth; x += 1) {
        const sx = Math.min(srcWidth - 1, Math.floor((x / scaledWidth) * srcWidth))
        const srcOffset = (sy * srcWidth + sx) * 4
        const dstOffset = ((offsetY + y) * dstWidth + (offsetX + x)) * 4
        out[dstOffset] = srcRgba[srcOffset]
        out[dstOffset + 1] = srcRgba[srcOffset + 1]
        out[dstOffset + 2] = srcRgba[srcOffset + 2]
        out[dstOffset + 3] = srcRgba[srcOffset + 3]
      }
    }
    return out
  }
  const writeScaledIdea = async (sourceImage) => {
    let targetImage = null
    if (await exists(targetPath)) {
      targetImage = await readImageByPath(targetPath)
    }
    const targetWidth = targetImage?.width ?? 64
    const targetHeight = targetImage?.height ?? 64
    const scaled = fitContainRgba({
      srcWidth: sourceImage.width,
      srcHeight: sourceImage.height,
      srcRgba: sourceImage.rgba,
      dstWidth: targetWidth,
      dstHeight: targetHeight,
    })
    if (ext === '.dds') {
      const ddsBuffer = encodeRgbaPngToRawDds({
        width: targetWidth,
        height: targetHeight,
        rgba: scaled,
      })
      await fs.writeFile(targetPath, ddsBuffer)
      return
    }
    if (ext === '.png') {
      const png = new PNG({ width: targetWidth, height: targetHeight })
      png.data = Buffer.from(scaled)
      await fs.writeFile(targetPath, PNG.sync.write(png))
      return
    }
    throw new Error(`unsupported portrait texture extension: ${ext}`)
  }
  const ext = path.extname(targetPath).toLowerCase()
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const isIdeaTarget = /[\\/]gfx[\\/]interface[\\/]ideas[\\/]/i.test(targetPath)
  if (ddsBase64) {
    const ddsBuffer = Buffer.from(ddsBase64, 'base64')
    let decodedImage = null
    try {
      decodedImage = decodeDdsToImage(ddsBuffer)
    } catch {
      throw new Error('DDS 解析失败，请使用 DXT1/DXT3/DXT5/ATI2 或可读取的未压缩 DDS')
    }
    const png = new PNG({ width: decodedImage.width, height: decodedImage.height })
    png.data = decodedImage.rgba
    if (isIdeaTarget) {
      await writeScaledIdea(decodedImage)
      return
    }
    if (ext === '.dds') {
      await fs.writeFile(targetPath, ddsBuffer)
      return
    }
    if (ext === '.png') {
      await fs.writeFile(targetPath, PNG.sync.write(png))
      return
    }
    throw new Error(`unsupported portrait texture extension: ${ext}`)
  }
  const pngBuffer = decodePngDataUrl(imageDataUrl)
  const parsed = PNG.sync.read(pngBuffer)
  if (isIdeaTarget) {
    await writeScaledIdea({
      width: parsed.width,
      height: parsed.height,
      rgba: parsed.data,
    })
    return
  }
  const pngOut = new PNG({ width: defaultPortraitWidth, height: defaultPortraitHeight })
  if (parsed.width !== defaultPortraitWidth || parsed.height !== defaultPortraitHeight) {
    throw new Error('cropped image size mismatch')
  }
  pngOut.data = Buffer.from(parsed.data)
  if (ext === '.dds') {
    const ddsBuffer = encodeRgbaPngToRawDds({
      width: defaultPortraitWidth,
      height: defaultPortraitHeight,
      rgba: pngOut.data,
    })
    await fs.writeFile(targetPath, ddsBuffer)
    return
  }
  if (ext === '.png') {
    await fs.writeFile(targetPath, PNG.sync.write(pngOut))
    return
  }
  throw new Error(`unsupported portrait texture extension: ${ext}`)
}

const ensureIdeaSpriteType = async ({ spriteName, textureFile }) => {
  const folder = path.join(modRoot, 'interface')
  await fs.mkdir(folder, { recursive: true })
  const filePath = path.join(folder, 'PW_character_editor_ideas.gfx')
  if (!(await exists(filePath))) {
    await fs.writeFile(filePath, 'spriteTypes = {\n}\n', 'utf8')
  }
  const text = await fs.readFile(filePath, 'utf8')
  const entry = `\tspriteType = {\n\t\tname = "${spriteName}"\n\t\ttexturefile = "${textureFile.replaceAll('\\', '/')}"\n\t}\n`
  const escaped = spriteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\s*spriteType\\s*=\\s*\\{[\\s\\S]*?name\\s*=\\s*"${escaped}"[\\s\\S]*?\\}`, 'm')
  const updated = re.test(text) ? text.replace(re, entry.trimEnd()) : text.replace(/\}\s*$/, `${entry}}\n`)
  if (updated !== text) {
    await fs.writeFile(filePath, updated, 'utf8')
    spriteIndexCache = null
  }
}

const updateCharacterSmallPortraitSpriteInFile = async ({ characterId, spriteName }) => {
  const index = await buildCharacterFileIndex()
  const target = index.get(characterId)
  if (!target?.filePath) {
    return false
  }
  const filePath = target.filePath
  const text = await fs.readFile(filePath, 'utf8')
  const escaped = characterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const idRe = new RegExp(`\\b${escaped}\\s*=\\s*\\{`, 'g')
  let match
  let changed = false
  let lastIndex = 0
  let result = ''
  while ((match = idRe.exec(text))) {
    const start = match.index
    const open = text.indexOf('{', start)
    let i = open + 1
    let depth = 1
    let inString = false
    while (i < text.length && depth > 0) {
      const ch = text[i]
      if (ch === '"' && text[i - 1] !== '\\') inString = !inString
      else if (!inString) {
        if (ch === '{') depth += 1
        if (ch === '}') depth -= 1
      }
      i += 1
    }
    const end = i
    const block = text.slice(start, end)
    let next = block
    const smallRe = /(civilian\s*=\s*\{[\s\S]*?\bsmall\s*=\s*)(?:"[^"]+"|[A-Za-z0-9_]+)/
    if (smallRe.test(next)) {
      next = next.replace(smallRe, `$1${spriteName}`)
    } else {
      const civilianOpenRe = /(civilian\s*=\s*\{)/
      if (civilianOpenRe.test(next)) {
        next = next.replace(civilianOpenRe, `$1\n\t\t\t\tsmall = ${spriteName}`)
      }
    }
    result += text.slice(lastIndex, start) + next
    if (next !== block) changed = true
    lastIndex = end
    idRe.lastIndex = end
  }
  result += text.slice(lastIndex)
  if (!changed) {
    return false
  }
  await fs.writeFile(filePath, result, 'utf8')
  characterDefinitionsCache = null
  characterFileIndexCache = null
  return true
}

const buildCharacterFileIndex = async () => {
  if (characterFileIndexCache) {
    return characterFileIndexCache
  }
  const files = await readAllFiles(path.join(modRoot, 'common', 'characters'), ['.txt'])
  const index = new Map()
  for (const filePath of files) {
    const baseName = path.basename(filePath).toLowerCase()
    if (baseName.includes('portrait_overrides') || baseName.includes('trait_overrides')) {
      continue
    }
    const text = await fs.readFile(filePath, 'utf8')
    const chars = findCharacterDefinitions(text)
    for (const character of chars) {
      const existing = index.get(character.id)
      const tag = (character.id.match(/^([A-Z0-9]{2,4})_/)?.[1] ?? '').toLowerCase()
      const score = baseName.startsWith(`${tag}.`) || baseName.startsWith(`${tag}_`) ? 2 : 1
      if (!existing || score > existing.score) {
        index.set(character.id, { filePath, score })
      }
    }
  }
  characterFileIndexCache = index
  return characterFileIndexCache
}

const purgeLegacyEditorOverrides = async (characterId) => {
  const escaped = characterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const characterRe = new RegExp(`\\n\\t${escaped}\\s*=\\s*\\{[\\s\\S]*?\\n\\t\\}`, 'm')
  const overrideFiles = [
    path.join(modRoot, 'common', 'characters', 'PW_character_editor_trait_overrides.txt'),
    path.join(modRoot, 'common', 'characters', 'PW_character_editor_portrait_overrides.txt'),
  ]
  for (const filePath of overrideFiles) {
    if (!(await exists(filePath))) {
      continue
    }
    const text = await fs.readFile(filePath, 'utf8')
    const updated = text.replace(characterRe, '')
    if (updated !== text) {
      await fs.writeFile(filePath, updated, 'utf8')
    }
  }
  const gfxPath = path.join(modRoot, 'interface', 'PW_character_editor_portraits.gfx')
  if (await exists(gfxPath)) {
    const spriteName = `GFX_PW_portrait_${characterId}`
    const escapedSprite = spriteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const spriteRe = new RegExp(`\\s*spriteType\\s*=\\s*\\{[\\s\\S]*?name\\s*=\\s*"${escapedSprite}"[\\s\\S]*?\\}`, 'm')
    const text = await fs.readFile(gfxPath, 'utf8')
    const updated = text.replace(spriteRe, '')
    if (updated !== text) {
      await fs.writeFile(gfxPath, updated, 'utf8')
      spriteIndexCache = null
    }
  }
  const legacyFolder = path.join(modRoot, 'gfx', 'leaders', 'PW_editor')
  if (await exists(legacyFolder)) {
    const prefix = `${characterId}_`
    const files = await fs.readdir(legacyFolder)
    for (const fileName of files) {
      if (!fileName.startsWith(prefix)) {
        continue
      }
      try {
        await fs.unlink(path.join(legacyFolder, fileName))
      } catch {
        continue
      }
    }
  }
}

const updateCharacterTraitsInFile = async ({ characterId, traits }) => {
  const index = await buildCharacterFileIndex()
  const target = index.get(characterId)
  if (!target?.filePath) {
    return false
  }
  const filePath = target.filePath
  const traitsText = `{ ${traits.join(' ')} }`
  const text = await fs.readFile(filePath, 'utf8')
  const escaped = characterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const idRe = new RegExp(`\\b${escaped}\\s*=\\s*\\{`, 'g')
  let match
  let lastIndex = 0
  let updatedText = ''
  let changed = false
  while ((match = idRe.exec(text))) {
    const assignmentStart = match.index
    const openBraceIndex = text.indexOf('{', assignmentStart)
    if (openBraceIndex < 0) {
      continue
    }
    let i = openBraceIndex + 1
    let depth = 1
    let inString = false
    while (i < text.length && depth > 0) {
      const ch = text[i]
      if (ch === '"' && text[i - 1] !== '\\') {
        inString = !inString
      } else if (!inString) {
        if (ch === '{') depth += 1
        if (ch === '}') depth -= 1
      }
      i += 1
    }
    if (depth !== 0) {
      continue
    }
    const assignmentEnd = i
    const blockText = text.slice(assignmentStart, assignmentEnd)
    let nextBlockText = blockText
    const ideaTraitsRe = new RegExp(`(idea_token\\s*=\\s*${escaped}[\\s\\S]*?\\btraits\\s*=\\s*)\\{[^}]*\\}`)
    if (ideaTraitsRe.test(nextBlockText)) {
      nextBlockText = nextBlockText.replace(ideaTraitsRe, `$1${traitsText}`)
    } else {
      const roleTraitsRe = /((?:advisor|country_leader|corps_commander|field_marshal|navy_leader)\s*=\s*\{[\s\S]*?\btraits\s*=\s*)\{[^}]*\}/
      if (roleTraitsRe.test(nextBlockText)) {
        nextBlockText = nextBlockText.replace(roleTraitsRe, `$1${traitsText}`)
      } else {
        const roleInsertRe = /((?:advisor|country_leader|corps_commander|field_marshal|navy_leader)\s*=\s*\{)/
        if (roleInsertRe.test(nextBlockText)) {
          nextBlockText = nextBlockText.replace(roleInsertRe, `$1\n\t\t\ttraits = ${traitsText}`)
        }
      }
    }
    updatedText += text.slice(lastIndex, assignmentStart)
    updatedText += nextBlockText
    lastIndex = assignmentEnd
    if (nextBlockText !== blockText) {
      changed = true
    }
    idRe.lastIndex = assignmentEnd
  }
  if (!changed) {
    return false
  }
  updatedText += text.slice(lastIndex)
  await fs.writeFile(filePath, updatedText, 'utf8')
  await purgeLegacyEditorOverrides(characterId)
  if (characterDefinitionsCache?.has(characterId)) {
    const current = characterDefinitionsCache.get(characterId)
    characterDefinitionsCache.set(characterId, {
      ...current,
      body: current.body.replace(/\btraits\s*=\s*\{[^}]*\}/, `traits = ${traitsText}`),
      traitsBlocks: [{ traits }],
    })
  }
  characterFileIndexCache = null
  return true
}

const ensureCharactersFile = async () => {
  const folder = path.join(modRoot, 'common', 'characters')
  await fs.mkdir(folder, { recursive: true })
  const filePath = path.join(folder, 'PW_character_editor_generated.txt')
  if (!(await exists(filePath))) {
    await fs.writeFile(filePath, 'characters = {\n}\n', 'utf8')
  }
  return filePath
}

const appendCharacter = async ({ id, nameToken, roleType, traits }) => {
  const filePath = await ensureCharactersFile()
  const text = await fs.readFile(filePath, 'utf8')
  const traitText = traits.length ? `traits = { ${traits.join(' ')} }` : 'traits = { }'
  let roleBlock = `\t\tadvisor = {\n\t\t\tslot = political_advisor\n\t\t\tidea_token = ${id}\n\t\t\t${traitText}\n\t\t}\n`
  if (roleType === 'country_leader') {
    roleBlock = `\t\tcountry_leader = {\n\t\t\tideology = neutrality\n\t\t\t${traitText}\n\t\t}\n`
  }
  const characterBlock = `\t${id} = {\n\t\tname = ${nameToken}\n${roleBlock}\t}\n`
  const updatedText = text.replace(/\}\s*$/, `${characterBlock}}\n`)
  await fs.writeFile(filePath, updatedText, 'utf8')
}

const escapeLocalizationValue = (value) => String(value ?? '').replaceAll('"', '\\"')

const ensureLocalizationEntryInFile = async ({ localeFolder, localeHeader, locKey, value }) => {
  const folder = path.join(modRoot, 'localisation', localeFolder)
  await fs.mkdir(folder, { recursive: true })
  const filePath = path.join(folder, `PW_character_editor_l_${localeFolder}.yml`)
  const safeValue = escapeLocalizationValue(value)
  if (!(await exists(filePath))) {
    const initial = `${localeHeader}:\n ${locKey}:0 "${safeValue}"\n`
    await fs.writeFile(filePath, initial, 'utf8')
    return
  }
  const text = await fs.readFile(filePath, 'utf8')
  if (new RegExp(`\\b${locKey}:`).test(text)) {
    const updated = text.replace(new RegExp(`${locKey}:\\d*\\s*"[^"]*"`), `${locKey}:0 "${safeValue}"`)
    await fs.writeFile(filePath, updated, 'utf8')
    return
  }
  const updated = `${text.trimEnd()}\n ${locKey}:0 "${safeValue}"\n`
  await fs.writeFile(filePath, updated, 'utf8')
}

const ensureLocalizationEntry = async (locKey, value) => {
  await ensureLocalizationEntryInFile({
    localeFolder: 'simp_chinese',
    localeHeader: 'l_simp_chinese',
    locKey,
    value,
  })
  await ensureLocalizationEntryInFile({
    localeFolder: 'english',
    localeHeader: 'l_english',
    locKey,
    value,
  })
}

const ensureRecruitCharacter = async (tag, id) => {
  const folder = path.join(modRoot, 'history', 'countries')
  await fs.mkdir(folder, { recursive: true })
  const existing = await findCountryHistoryFile(tag, true)
  const target = existing && existing.startsWith(folder) ? existing : path.join(folder, `${tag} - Character Editor.txt`)
  if (!(await exists(target))) {
    await fs.writeFile(target, `${tag} = {\n\trecruit_character = ${id}\n}\n`, 'utf8')
    return
  }
  const text = await fs.readFile(target, 'utf8')
  if (new RegExp(`\\brecruit_character\\s*=\\s*${id}\\b`).test(text)) {
    return
  }
  const lastLineBreak = text.lastIndexOf('\n')
  const insertText = `\nrecruit_character = ${id}`
  const updated =
    lastLineBreak > -1
      ? `${text.slice(0, lastLineBreak)}${insertText}${text.slice(lastLineBreak)}`
      : `${text}${insertText}`
  await fs.writeFile(target, updated, 'utf8')
}

const decodePngDataUrl = (imageDataUrl) => {
  const match = String(imageDataUrl ?? '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
  if (!match) {
    throw new Error('imageDataUrl must be a PNG data URL')
  }
  return Buffer.from(match[1], 'base64')
}

const encodeRgbaPngToRawDds = ({ width, height, rgba }) => {
  const header = Buffer.alloc(128, 0)
  header.write('DDS ', 0, 4, 'ascii')
  header.writeUInt32LE(124, 4)
  header.writeUInt32LE(0x100f, 8)
  header.writeUInt32LE(height, 12)
  header.writeUInt32LE(width, 16)
  header.writeUInt32LE(width * 4, 20)
  header.writeUInt32LE(0, 24)
  header.writeUInt32LE(0, 28)
  header.writeUInt32LE(32, 76)
  header.writeUInt32LE(0x41, 80)
  header.writeUInt32LE(0, 84)
  header.writeUInt32LE(32, 88)
  header.writeUInt32LE(0x00ff0000, 92)
  header.writeUInt32LE(0x0000ff00, 96)
  header.writeUInt32LE(0x000000ff, 100)
  header.writeUInt32LE(0xff000000, 104)
  header.writeUInt32LE(0x1000, 108)
  const pixels = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const src = i * 4
    const dst = i * 4
    pixels[dst] = rgba[src + 2]
    pixels[dst + 1] = rgba[src + 1]
    pixels[dst + 2] = rgba[src]
    pixels[dst + 3] = rgba[src + 3]
  }
  return Buffer.concat([header, pixels])
}

const collectTraitDetails = async () => {
  const roots = [
    path.join(gameRoot, 'common', 'country_leader'),
    path.join(modRoot, 'common', 'country_leader'),
  ]
  const details = new Map()
  for (const folder of roots) {
    const files = await readAllFiles(folder, ['.txt'])
    for (const filePath of files) {
      const text = await fs.readFile(filePath, 'utf8')
      const traitBlocks = findBlocksByKey(text, 'leader_traits')
      for (const block of traitBlocks) {
        const re = /([A-Za-z0-9_]+)\s*=\s*\{/g
        let match
        while ((match = re.exec(block.content))) {
          const id = match[1]
          const braceStart = match.index + match[0].lastIndexOf('{')
          let i = braceStart + 1
          let depth = 1
          let inString = false
          while (i < block.content.length && depth > 0) {
            const ch = block.content[i]
            if (ch === '"' && block.content[i - 1] !== '\\') {
              inString = !inString
            } else if (!inString) {
              if (ch === '{') depth += 1
              if (ch === '}') depth -= 1
            }
            i += 1
          }
          if (depth !== 0) {
            continue
          }
          const body = block.content.slice(braceStart + 1, i - 1)
          const modifierRange = findBlockRangeByKey(body, 'modifier')
          const modifierText = modifierRange ? body.slice(modifierRange.start, modifierRange.end) : body
          const modifiers = []
          for (const line of modifierText.split(/\r?\n/)) {
            const pure = line.trim()
            if (!pure || pure.startsWith('#') || pure.includes('{') || pure.includes('}')) {
              continue
            }
            const m = pure.match(/^([A-Za-z0-9_@.:-]+)\s*=\s*(-?\d+(?:\.\d+)?)/)
            if (m) {
              modifiers.push({ key: m[1], value: Number(m[2]) })
            }
          }
          if (!details.has(id) || filePath.startsWith(modRoot)) {
            details.set(id, {
              id,
              modifiers,
              source: filePath.startsWith(modRoot) ? 'mod' : 'base',
              sourceFile: filePath,
            })
          }
          re.lastIndex = i
        }
      }
    }
  }
  const list = [...details.values()]
  const localizationKeys = list.flatMap((item) => [item.id, `${item.id}_desc`])
  const localizationMap = await loadLocalizationValues(localizationKeys, false)
  for (const item of list) {
    item.localizedName = localizationMap.get(item.id) ?? item.id
    item.localizedDescription = localizationMap.get(`${item.id}_desc`) ?? ''
  }
  return list.sort((a, b) => a.id.localeCompare(b.id))
}

const upsertEditorTrait = async ({ id, modifiers }) => {
  const folder = path.join(modRoot, 'common', 'country_leader')
  await fs.mkdir(folder, { recursive: true })
  const filePath = path.join(folder, 'PW_character_editor_traits.txt')
  if (!(await exists(filePath))) {
    await fs.writeFile(filePath, 'leader_traits = {\n}\n', 'utf8')
  }
  const text = await fs.readFile(filePath, 'utf8')
  const modifierLines = modifiers.map((item) => `\t\t\t${item.key} = ${item.value}`).join('\n')
  const traitBlock = `\t${id} = {\n\t\tmodifier = {\n${modifierLines}\n\t\t}\n\t}\n`
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const traitRe = new RegExp(`\\s*${escaped}\\s*=\\s*\\{[\\s\\S]*?\\n\\t\\}`, 'm')
  if (traitRe.test(text)) {
    const updated = text.replace(traitRe, traitBlock.trimEnd())
    await fs.writeFile(filePath, updated, 'utf8')
    return
  }
  const updated = text.replace(/\}\s*$/, `${traitBlock}}\n`)
  await fs.writeFile(filePath, updated, 'utf8')
}

app.get('/api/health', (_, res) => {
  res.json({ ok: true })
})

app.get('/api/meta', async (_, res) => {
  const modExists = await exists(modRoot)
  const gameExists = await exists(gameRoot)
  res.json({
    modRoot,
    gameRoot,
    modExists,
    gameExists,
  })
})

app.get('/api/tags', async (_, res) => {
  const roots = [
    path.join(modRoot, 'history', 'countries'),
    path.join(gameRoot, 'history', 'countries'),
  ]
  const map = new Map()
  for (const root of roots) {
    if (!(await exists(root))) {
      continue
    }
    const entries = await fs.readdir(root)
    for (const entry of entries) {
      const tag = extractTag(entry)
      if (!tag) continue
      if (!map.has(tag)) {
        map.set(tag, {
          tag,
          file: entry,
          source: root.startsWith(modRoot) ? 'mod' : 'base',
        })
      }
    }
  }
  const tags = [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag))
  res.json(tags)
})

app.get('/api/traits', async (_, res) => {
  const traits = await loadTraitReference()
  res.json(traits)
})

app.get('/api/traits/detail', async (_, res) => {
  const traits = await collectTraitDetails()
  res.json(traits)
})

app.post('/api/traits/upsert', async (req, res) => {
  const id = String(req.body?.id ?? '').trim()
  const modifiers = Array.isArray(req.body?.modifiers)
    ? req.body.modifiers
        .map((item) => ({
          key: String(item?.key ?? '').trim(),
          value: Number(item?.value),
        }))
        .filter((item) => item.key && Number.isFinite(item.value))
    : []
  if (!id) {
    res.status(400).json({ error: 'id is required' })
    return
  }
  await upsertEditorTrait({ id, modifiers })
  res.json({ success: true })
})

app.post('/api/traits/:id/localization', async (req, res) => {
  const id = String(req.params.id ?? '').trim()
  const localizedName = String(req.body?.localizedName ?? '').trim()
  const localizedDescription = String(req.body?.localizedDescription ?? '').trim()
  if (!id) {
    res.status(400).json({ error: 'id is required' })
    return
  }
  if (!localizedName && !localizedDescription) {
    res.status(400).json({ error: 'localizedName or localizedDescription is required' })
    return
  }
  if (localizedName) {
    await ensureLocalizationEntry(id, localizedName)
  }
  if (localizedDescription) {
    await ensureLocalizationEntry(`${id}_desc`, localizedDescription)
  }
  localizationMapCache = null
  res.json({ success: true })
})

app.get('/api/characters', async (req, res) => {
  const tag = String(req.query.tag ?? '').toUpperCase()
  if (!tag) {
    res.status(400).json({ error: 'tag is required' })
    return
  }
  const data = await readCharacterListByTag(tag)
  res.json(data)
})

app.get('/api/characters/:id', async (req, res) => {
  const tag = String(req.query.tag ?? '').toUpperCase()
  const characterId = String(req.params.id ?? '').trim()
  const includePortrait = String(req.query.portrait ?? '') === '1'
  if (!tag || !characterId) {
    res.status(400).json({ error: 'tag and id are required' })
    return
  }
  const character = await readCharacterDetail(tag, characterId, includePortrait)
  if (!character) {
    res.status(404).json({ error: 'character not found' })
    return
  }
  res.json({
    ...character,
    portraitUrl: character.portraitPath
      ? `/api/image?path=${encodeURIComponent(character.portraitPath)}${character.portraitVersion ? `&v=${Math.trunc(character.portraitVersion)}` : ''}`
      : null,
  })
})

app.post('/api/characters/:id/traits', async (req, res) => {
  const characterId = req.params.id
  const traits = Array.isArray(req.body?.traits) ? req.body.traits.filter(Boolean) : []
  const success = await updateCharacterTraitsInFile({ characterId, traits })
  if (!success) {
    res.status(404).json({ error: 'character not found in mod files' })
    return
  }
  characterDefinitionsCache = null
  res.json({ success: true })
})

app.post('/api/characters/:id/localization', async (req, res) => {
  const characterId = req.params.id
  const localizedName = String(req.body?.localizedName ?? '').trim()
  if (!localizedName) {
    res.status(400).json({ error: 'localizedName is required' })
    return
  }
  const definitions = await loadCharacterDefinitions(false)
  const character = definitions.get(characterId)
  const nameToken = character?.nameToken || `${characterId}_name`
  await ensureLocalizationEntry(nameToken, localizedName)
  localizationMapCache = null
  res.json({ success: true })
})

app.post('/api/characters/:id/description-localization', async (req, res) => {
  const characterId = req.params.id
  const localizedDescription = String(req.body?.localizedDescription ?? '').trim()
  if (!localizedDescription) {
    res.json({ success: true, skipped: true })
    return
  }
  const definitions = await loadCharacterDefinitions(false)
  const character = definitions.get(characterId)
  const descToken = character?.descToken || `${characterId}_desc`
  await ensureLocalizationEntry(descToken, localizedDescription)
  localizationMapCache = null
  res.json({ success: true })
})

app.post('/api/characters', async (req, res) => {
  const id = String(req.body?.id ?? '').trim()
  const displayName = String(req.body?.displayName ?? '').trim()
  const tag = String(req.body?.tag ?? '').trim().toUpperCase()
  const roleType = String(req.body?.roleType ?? 'advisor').trim()
  const traits = Array.isArray(req.body?.traits) ? req.body.traits.filter(Boolean) : []
  if (!id || !displayName || !tag) {
    res.status(400).json({ error: 'id, displayName and tag are required' })
    return
  }
  const nameToken = `${id}_name`
  await appendCharacter({ id, nameToken, roleType, traits })
  await ensureLocalizationEntry(nameToken, displayName)
  await ensureRecruitCharacter(tag, id)
  characterDefinitionsCache = null
  characterFileIndexCache = null
  localizationMapCache = null
  res.json({ success: true })
})

app.post('/api/characters/:id/portrait/import', async (req, res) => {
  const characterId = req.params.id
  const imageDataUrl = String(req.body?.imageDataUrl ?? '')
  const ddsBase64 = String(req.body?.ddsBase64 ?? '')
  if (!characterId || (!imageDataUrl && !ddsBase64)) {
    res.status(400).json({ error: 'characterId and imageDataUrl or ddsBase64 are required' })
    return
  }
  await purgeLegacyEditorOverrides(characterId)
  characterDefinitionsCache = null
  const target = await resolveCharacterPortraitTarget(characterId)
  if (!target) {
    res.status(404).json({ error: 'character portrait sprite/texturefile not found in character files' })
    return
  }
  let ideaTarget = null
  try {
    await writePortraitDataToTarget({
      targetPath: target.absoluteTarget,
      imageDataUrl,
      ddsBase64,
    })
    ideaTarget = await resolveCharacterIdeaTarget(characterId, target.character)
    if (ideaTarget) {
      if (ideaTarget.needsRewire) {
        await ensureIdeaSpriteType({
          spriteName: ideaTarget.spriteName,
          textureFile: ideaTarget.texturePath,
        })
        await updateCharacterSmallPortraitSpriteInFile({
          characterId,
          spriteName: ideaTarget.spriteName,
        })
      }
      await writePortraitDataToTarget({
        targetPath: ideaTarget.absoluteTarget,
        imageDataUrl,
        ddsBase64,
      })
    }
  } catch (error) {
    res.status(400).json({ error: error.message })
    return
  }
  if (spriteMapCache) {
    spriteMapCache.set(target.spriteName, target.texturePath.replaceAll('/', path.sep))
    if (ideaTarget) {
      spriteMapCache.set(ideaTarget.spriteName, ideaTarget.texturePath.replaceAll('/', path.sep))
    }
  }
  portraitLookupCache = null
  const browserPath = await toBrowserFriendlyPortraitPath(target.absoluteTarget)
  const portraitUrl = browserPath ? `/api/image?path=${encodeURIComponent(browserPath)}` : null
  res.json({
    success: true,
    portraitUrl,
    spriteName: target.spriteName,
    textureFile: target.texturePath,
    ideaSpriteName: ideaTarget?.spriteName ?? null,
    ideaTextureFile: ideaTarget?.texturePath ?? null,
  })
})

app.get('/api/image', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const requested = String(req.query.path ?? '')
  const decoded = decodeURIComponent(requested)
  if (!decoded) {
    res.status(404).end()
    return
  }
  const allowedRoots = [modRoot, gameRoot]
  const isAllowed = allowedRoots.some((root) => decoded.startsWith(root))
  if (!isAllowed) {
    res.status(403).end()
    return
  }
  if (!(await exists(decoded))) {
    res.status(404).end()
    return
  }
  const ext = path.extname(decoded).toLowerCase()
  if (ext === '.dds') {
    try {
      const ddsBuffer = await fs.readFile(decoded)
      const decodedImage = decodeDdsToImage(ddsBuffer)
      const png = new PNG({ width: decodedImage.width, height: decodedImage.height })
      png.data = decodedImage.rgba
      const out = PNG.sync.write(png)
      res.type('image/png')
      res.send(out)
      return
    } catch {
      res.type('image/svg+xml')
      res.send(buildFallbackSvg(path.basename(decoded)))
      return
    }
  }
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.tga': 'image/x-tga',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  }
  if (!map[ext]) {
    res.type('image/svg+xml')
    res.send(buildFallbackSvg(path.basename(decoded)))
    return
  }
  res.type(map[ext])
  const content = await fs.readFile(decoded)
  res.send(content)
})

app.listen(5179, () => {
  console.log('Character API listening on http://localhost:5179')
})
