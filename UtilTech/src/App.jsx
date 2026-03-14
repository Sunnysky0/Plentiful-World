import { useEffect, useMemo, useState } from 'react'

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `请求失败: ${response.status}`)
  }
  return data
}

const emptyDetail = (type) => ({
  id: '',
  type,
  category: '',
  source: '',
  filePath: '',
  name_zh: '',
  desc_zh: '',
  short_zh: '',
  name_en: '',
  desc_en: '',
  short_en: '',
  raw: '',
  modifiers: [],
})

const toModifierRows = (input) => {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => ({
      key: String(item?.key ?? '').trim(),
      value: String(item?.value ?? '').trim(),
    }))
    .filter((item) => item.key || item.value)
}

export default function App() {
  const [entityType, setEntityType] = useState('technology')
  const [meta, setMeta] = useState(null)
  const [list, setList] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState(emptyDetail('technology'))
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('all')
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [newId, setNewId] = useState('')
  const [guideEquipmentId, setGuideEquipmentId] = useState('')
  const [guideResult, setGuideResult] = useState(null)
  const [guideLoading, setGuideLoading] = useState(false)

  const isTechnology = entityType === 'technology'

  const categories = useMemo(() => {
    if (!meta) return ['all']
    return isTechnology ? ['all', ...(meta.techCategories || [])] : ['all', ...(meta.equipmentCategories || [])]
  }, [isTechnology, meta])

  const modifierHints = useMemo(() => {
    if (!meta) return []
    return isTechnology ? meta.modifierHints?.technology || [] : meta.modifierHints?.equipment || []
  }, [isTechnology, meta])

  const listEndpoint = isTechnology ? '/api/techs' : '/api/equipments'
  const detailEndpoint = isTechnology ? '/api/techs' : '/api/equipments'
  const saveEndpoint = isTechnology ? '/api/techs/upsert' : '/api/equipments/upsert'

  const loadMeta = async () => {
    const data = await fetchJson('/api/meta')
    setMeta(data)
  }

  const loadList = async () => {
    setLoadingList(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (keyword.trim()) params.set('q', keyword.trim())
      if (category && category !== 'all') params.set('category', category)
      const data = await fetchJson(`${listEndpoint}?${params.toString()}`)
      setList(data)
      if (!data.some((item) => item.id === selectedId)) {
        const firstId = data[0]?.id || ''
        setSelectedId(firstId)
      }
    } catch (err) {
      setError(err.message)
      setList([])
    } finally {
      setLoadingList(false)
    }
  }

  const loadDetail = async (id) => {
    if (!id) {
      setDetail(emptyDetail(entityType))
      return
    }
    setLoadingDetail(true)
    setError('')
    try {
      const data = await fetchJson(`${detailEndpoint}/${encodeURIComponent(id)}`)
      setDetail(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => {
    setSelectedId('')
    setDetail(emptyDetail(entityType))
    setCategory('all')
    setKeyword('')
  }, [entityType])

  useEffect(() => {
    loadMeta().catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    loadList().catch(() => {})
  }, [entityType, keyword, category])

  useEffect(() => {
    loadDetail(selectedId).catch(() => {})
  }, [entityType, selectedId])

  const handleSave = async () => {
    if (!detail.id.trim()) {
      setError('ID不能为空')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await fetchJson(saveEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          id: detail.id.trim(),
          filePath: detail.filePath,
          category: detail.category,
          archetype: detail.archetype,
          raw: detail.raw,
          modifiers: detail.modifiers,
          name_zh: detail.name_zh,
          desc_zh: detail.desc_zh,
          short_zh: detail.short_zh,
          name_en: detail.name_en,
          desc_en: detail.desc_en,
          short_en: detail.short_en,
        }),
      })
      setMessage(`已保存 ${detail.id}`)
      setNewId('')
      await loadMeta()
      await loadList()
      await loadDetail(detail.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    const id = newId.trim()
    if (!id) {
      setError('请输入新ID')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await fetchJson(saveEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          id,
          category: category === 'all' ? '' : category,
          name_zh: id,
          name_en: id,
          raw: '',
        }),
      })
      setMessage(`已新增 ${id}`)
      setSelectedId(id)
      setNewId('')
      await loadMeta()
      await loadList()
      await loadDetail(id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleModifierChange = (index, field, value) => {
    setDetail((prev) => {
      const next = [...(prev.modifiers || [])]
      next[index] = { ...next[index], [field]: value }
      return { ...prev, modifiers: next }
    })
  }

  const handleAddModifier = () => {
    setDetail((prev) => ({
      ...prev,
      modifiers: [...(prev.modifiers || []), { key: '', value: '' }],
    }))
  }

  const handleRemoveModifier = (index) => {
    setDetail((prev) => ({
      ...prev,
      modifiers: (prev.modifiers || []).filter((_, idx) => idx !== index),
    }))
  }

  const handleExtractModifiersFromRaw = async () => {
    setError('')
    try {
      const payload = {
        type: isTechnology ? 'technology' : 'equipment',
        raw: detail.raw || '',
        modifiers: [],
      }
      const data = await fetchJson('/api/raw/apply-modifiers', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setDetail((prev) => ({ ...prev, modifiers: toModifierRows(data.modifiers) }))
      setMessage('已从 Raw 提取结构化效果')
    } catch (err) {
      setError(err.message)
    }
  }

  const handleApplyModifiersToRaw = async () => {
    setError('')
    try {
      const payload = {
        type: isTechnology ? 'technology' : 'equipment',
        raw: detail.raw || '',
        modifiers: detail.modifiers || [],
      }
      const data = await fetchJson('/api/raw/apply-modifiers', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setDetail((prev) => ({ ...prev, raw: data.raw, modifiers: toModifierRows(data.modifiers) }))
      setMessage('已将结构化效果应用到 Raw')
    } catch (err) {
      setError(err.message)
    }
  }

  const handleLinkGuide = async () => {
    if (!detail.id || !guideEquipmentId.trim()) {
      setError('请先选择科技并填写装备ID')
      return
    }
    setGuideLoading(true)
    setError('')
    setMessage('')
    try {
      const data = await fetchJson(`/api/techs/${encodeURIComponent(detail.id)}/link-equipment`, {
        method: 'POST',
        body: JSON.stringify({
          equipmentId: guideEquipmentId.trim(),
          autoFixLocalization: true,
        }),
      })
      setGuideResult(data)
      setMessage(`联动完成：${detail.id} -> ${guideEquipmentId.trim()}`)
      await loadMeta()
      await loadDetail(detail.id)
    } catch (err) {
      setError(err.message)
      setGuideResult(null)
    } finally {
      setGuideLoading(false)
    }
  }

  const activeName = detail.name_zh || detail.name_en || detail.id || '-'
  const structuredTech = isTechnology ? detail.structured || null : null
  const structuredEquipment = !isTechnology ? detail.structured || null : null

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1800px] p-4 md:p-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold">Plentiful_World 科技+装备联合编辑器</h1>
              <p className="mt-1 text-sm text-slate-300">
                支持按科技类别浏览、查看/编辑效果、并新增科技与装备。编辑规则对齐 HOI4 Modifiers / List of
                modifiers / Equipment modding / Technology modding。
              </p>
            </div>
            <div className="text-xs text-slate-400">
              <div>科技: {meta?.counts?.techs ?? '-'}</div>
              <div>装备: {meta?.counts?.equipments ?? '-'}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setEntityType('technology')}
              className={`rounded-md px-3 py-1.5 text-sm ${
                isTechnology ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-200'
              }`}
            >
              科技
            </button>
            <button
              type="button"
              onClick={() => setEntityType('equipment')}
              className={`rounded-md px-3 py-1.5 text-sm ${
                !isTechnology ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-200'
              }`}
            >
              装备
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[380px_1fr]">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="space-y-2">
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索 ID / 本地化名称"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                />
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                >
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  value={newId}
                  onChange={(event) => setNewId(event.target.value)}
                  placeholder={isTechnology ? '新增科技ID' : '新增装备ID'}
                  className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={saving}
                  className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  新增
                </button>
              </div>

              <div className="mt-3 max-h-[68vh] overflow-auto rounded-md border border-slate-800">
                {loadingList ? (
                  <div className="p-3 text-sm text-slate-400">加载中...</div>
                ) : list.length === 0 ? (
                  <div className="p-3 text-sm text-slate-400">暂无数据</div>
                ) : (
                  list.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full border-b border-slate-800 px-3 py-2 text-left last:border-b-0 ${
                        selectedId === item.id ? 'bg-cyan-950/60' : 'hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="text-sm font-medium text-slate-100">{item.id}</div>
                      <div className="text-xs text-slate-400">{item.name_zh || item.name_en || '-'}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{item.category}</div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 md:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm text-slate-400">当前对象</div>
                  <div className="text-lg font-semibold">{activeName}</div>
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || loadingDetail || !detail.id}
                  className="rounded-md bg-cyan-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  保存
                </button>
              </div>

              {loadingDetail ? (
                <div className="mt-4 text-sm text-slate-400">加载详情中...</div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="text-sm">
                      <div className="mb-1 text-slate-300">ID</div>
                      <input
                        value={detail.id}
                        onChange={(event) => setDetail((prev) => ({ ...prev, id: event.target.value }))}
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
                      />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-slate-300">分类</div>
                      <input
                        value={detail.category || ''}
                        onChange={(event) => setDetail((prev) => ({ ...prev, category: event.target.value }))}
                        placeholder="technology category / type"
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
                      />
                    </label>
                  </div>

                  <div className="text-xs text-slate-500">来源文件: {detail.source || '-'}</div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="text-sm">
                      <div className="mb-1 text-slate-300">中文名</div>
                      <input
                        value={detail.name_zh || ''}
                        onChange={(event) => setDetail((prev) => ({ ...prev, name_zh: event.target.value }))}
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
                      />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-slate-300">英文名</div>
                      <input
                        value={detail.name_en || ''}
                        onChange={(event) => setDetail((prev) => ({ ...prev, name_en: event.target.value }))}
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="text-sm">
                      <div className="mb-1 text-slate-300">中文描述</div>
                      <textarea
                        value={detail.desc_zh || ''}
                        onChange={(event) => setDetail((prev) => ({ ...prev, desc_zh: event.target.value }))}
                        rows={3}
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
                      />
                    </label>
                    <label className="text-sm">
                      <div className="mb-1 text-slate-300">英文描述</div>
                      <textarea
                        value={detail.desc_en || ''}
                        onChange={(event) => setDetail((prev) => ({ ...prev, desc_en: event.target.value }))}
                        rows={3}
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
                      />
                    </label>
                  </div>

                  {!isTechnology && (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        <div className="mb-1 text-slate-300">中文短名(_short)</div>
                        <input
                          value={detail.short_zh || ''}
                          onChange={(event) => setDetail((prev) => ({ ...prev, short_zh: event.target.value }))}
                          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
                        />
                      </label>
                      <label className="text-sm">
                        <div className="mb-1 text-slate-300">英文短名(_short)</div>
                        <input
                          value={detail.short_en || ''}
                          onChange={(event) => setDetail((prev) => ({ ...prev, short_en: event.target.value }))}
                          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500"
                        />
                      </label>
                    </div>
                  )}

                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <div className="text-sm font-medium text-slate-200">效果预览（解析到的 modifiers）</div>
                    <div className="mt-2 max-h-40 overflow-auto text-xs text-slate-300">
                      {detail.modifiers?.length ? (
                        detail.modifiers.map((item) => (
                          <div key={`${item.key}-${item.value}`} className="py-0.5">
                            {item.key} = {item.value}
                          </div>
                        ))
                      ) : (
                        <div className="text-slate-500">未解析到顶层数值 modifier，可直接在下方原始块中编辑。</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-slate-200">结构化效果编辑器</div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleExtractModifiersFromRaw}
                          className="rounded bg-slate-700 px-2.5 py-1 text-xs text-slate-100"
                        >
                          从 Raw 提取
                        </button>
                        <button
                          type="button"
                          onClick={handleApplyModifiersToRaw}
                          className="rounded bg-cyan-700 px-2.5 py-1 text-xs text-white"
                        >
                          应用到 Raw
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 max-h-48 space-y-2 overflow-auto pr-1">
                      {(detail.modifiers || []).map((item, index) => (
                        <div key={`${index}-${item.key}`} className="grid grid-cols-[1fr_160px_70px] gap-2">
                          <input
                            value={item.key || ''}
                            onChange={(event) => handleModifierChange(index, 'key', event.target.value)}
                            placeholder="modifier_key"
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs outline-none focus:border-cyan-500"
                          />
                          <input
                            value={item.value || ''}
                            onChange={(event) => handleModifierChange(index, 'value', event.target.value)}
                            placeholder="0.1"
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs outline-none focus:border-cyan-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveModifier(index)}
                            className="rounded bg-rose-700 px-2 py-1 text-xs text-white"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleAddModifier}
                      className="mt-2 rounded bg-emerald-700 px-2.5 py-1 text-xs text-white"
                    >
                      新增效果
                    </button>
                  </div>

                  <label className="text-sm block">
                    <div className="mb-1 text-slate-300">原始定义块（可直接编辑效果）</div>
                    <textarea
                      value={detail.raw || ''}
                      onChange={(event) => setDetail((prev) => ({ ...prev, raw: event.target.value }))}
                      rows={20}
                      spellCheck={false}
                      className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs outline-none focus:border-cyan-500"
                    />
                  </label>

                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                    <div className="text-sm font-medium text-slate-200">可用 modifier 参考</div>
                    <div className="mt-2 flex max-h-32 flex-wrap gap-1 overflow-auto">
                      {modifierHints.map((item) => (
                        <span key={item} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  {isTechnology && structuredTech && (
                    <div className="rounded-md border border-sky-700/40 bg-sky-950/20 p-3">
                      <div className="text-sm font-medium text-sky-200">科技结构化信息</div>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <div className="rounded border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-200">
                          <div className="mb-1 text-slate-400">标量字段</div>
                          {Object.entries(structuredTech.scalar_fields || {}).length ? (
                            Object.entries(structuredTech.scalar_fields || {}).map(([key, value]) => (
                              <div key={key}>
                                {key} = {String(value)}
                              </div>
                            ))
                          ) : (
                            <div className="text-slate-500">无</div>
                          )}
                        </div>
                        <div className="rounded border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-200">
                          <div className="mb-1 text-slate-400">分类 / 解锁装备</div>
                          <div>categories:</div>
                          {(structuredTech.categories || []).map((item) => (
                            <div key={item.key}>
                              {item.key} {item.name ? `(${item.name})` : ''}
                            </div>
                          ))}
                          <div className="mt-1">enable_equipments:</div>
                          {(structuredTech.enable_equipments || []).map((item) => (
                            <div key={item.key}>
                              {item.key} {item.name ? `(${item.name})` : ''}
                            </div>
                          ))}
                        </div>
                        <div className="rounded border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-200">
                          <div className="mb-1 text-slate-400">路径 / 依赖</div>
                          <div>paths:</div>
                          {(structuredTech.paths || []).map((item, idx) => (
                            <div key={`${item.leads_to_tech}-${idx}`}>
                              {item.leads_to_tech || '-'} coeff={item.research_cost_coeff || '-'}
                            </div>
                          ))}
                          <div className="mt-1">dependencies:</div>
                          {(structuredTech.dependencies || []).map((item) => (
                            <div key={item.tech}>
                              {item.tech}={item.weight}
                            </div>
                          ))}
                        </div>
                        <div className="rounded border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-200">
                          <div className="mb-1 text-slate-400">触发 / 完成效果</div>
                          <div>allow: {(structuredTech.triggers?.allow || '').slice(0, 120) || '-'}</div>
                          <div className="mt-1">
                            allow_branch: {(structuredTech.triggers?.allow_branch || '').slice(0, 120) || '-'}
                          </div>
                          <div className="mt-1">
                            on_research_complete:{' '}
                            {(structuredTech.effects?.on_research_complete || '').slice(0, 120) || '-'}
                          </div>
                        </div>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-sky-300">查看完整结构化 JSON</summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-300">
                          {JSON.stringify(structuredTech, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}

                  {!isTechnology && structuredEquipment && (
                    <div className="rounded-md border border-sky-700/40 bg-sky-950/20 p-3">
                      <div className="text-sm font-medium text-sky-200">装备结构化信息</div>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <div className="rounded border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-200">
                          <div className="mb-1 text-slate-400">基础字段</div>
                          {Object.entries(structuredEquipment.scalar_fields || {}).length ? (
                            Object.entries(structuredEquipment.scalar_fields || {}).map(([key, value]) => (
                              <div key={key}>
                                {key} = {String(value)}
                              </div>
                            ))
                          ) : (
                            <div className="text-slate-500">无</div>
                          )}
                          <div className="mt-1">
                            category: {structuredEquipment.category?.key || '-'}{' '}
                            {structuredEquipment.category?.name ? `(${structuredEquipment.category?.name})` : ''}
                          </div>
                        </div>
                        <div className="rounded border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-200">
                          <div className="mb-1 text-slate-400">resources</div>
                          {(structuredEquipment.resources || []).length ? (
                            structuredEquipment.resources.map((item) => (
                              <div key={item.key}>
                                {item.key} = {item.value}
                              </div>
                            ))
                          ) : (
                            <div className="text-slate-500">无</div>
                          )}
                          <div className="mt-1 text-slate-400">can_be_produced</div>
                          <div>{(structuredEquipment.can_be_produced || '').slice(0, 140) || '-'}</div>
                        </div>
                        <div className="rounded border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-200">
                          <div className="mb-1 text-slate-400">archetype继承链</div>
                          {(structuredEquipment.archetype_chain || []).length ? (
                            structuredEquipment.archetype_chain.map((item, idx) => (
                              <div key={`${item.id}-${idx}`}>
                                {idx + 1}. {item.id} {item.name_zh ? `(${item.name_zh})` : ''}
                              </div>
                            ))
                          ) : (
                            <div className="text-slate-500">无</div>
                          )}
                          <div className="mb-1 mt-2 text-slate-400">parent继承链</div>
                          {(structuredEquipment.parent_chain || []).length ? (
                            structuredEquipment.parent_chain.map((item, idx) => (
                              <div key={`${item.id}-${idx}`}>
                                {idx + 1}. {item.id} {item.name_zh ? `(${item.name_zh})` : ''}
                              </div>
                            ))
                          ) : (
                            <div className="text-slate-500">无</div>
                          )}
                        </div>
                        <div className="rounded border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-200">
                          <div className="mb-1 text-slate-400">关键战斗属性分组</div>
                          {Object.entries(structuredEquipment.stat_groups || {}).map(([groupKey, values]) => (
                            <div key={groupKey} className="mb-1">
                              <div className="text-slate-300">{groupKey}</div>
                              {values?.length ? (
                                values.map((item) => (
                                  <div key={`${groupKey}-${item.key}`}>
                                    {item.key} = {item.value}
                                  </div>
                                ))
                              ) : (
                                <div className="text-slate-500">-</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-sky-300">查看完整结构化 JSON</summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-300">
                          {JSON.stringify(structuredEquipment, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}

                  {isTechnology && (
                    <div className="rounded-md border border-amber-700/40 bg-amber-950/30 p-3">
                      <div className="text-sm font-medium text-amber-200">科技-装备联动向导</div>
                      <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                        <input
                          value={guideEquipmentId}
                          onChange={(event) => setGuideEquipmentId(event.target.value)}
                          placeholder="输入装备ID，例如 pw_infantry_equipment_1"
                          className="rounded border border-amber-700/40 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-500"
                        />
                        <button
                          type="button"
                          onClick={handleLinkGuide}
                          disabled={guideLoading || !detail.id}
                          className="rounded bg-amber-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                        >
                          自动联动
                        </button>
                      </div>
                      {guideResult && (
                        <div className="mt-3 text-xs text-amber-100">
                          <div className="font-medium">检查结果（Before → After）</div>
                          {Object.keys(guideResult.checksAfter || {}).map((key) => (
                            <div key={key} className="mt-0.5">
                              {key}: {String(guideResult.checksBefore?.[key])} →{' '}
                              {String(guideResult.checksAfter?.[key])}
                            </div>
                          ))}
                          <div className="mt-2 text-amber-300">{guideResult.note}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {(message || error) && (
            <div className="mt-4 rounded-md border border-slate-700 bg-slate-900 p-3 text-sm">
              {message && <div className="text-emerald-400">{message}</div>}
              {error && <div className="text-rose-400">{error}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
