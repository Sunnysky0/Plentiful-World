import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function App() {
  const defaultPortraitWidth = 156
  const defaultPortraitHeight = 210

  const [meta, setMeta] = useState(null)
  const [tags, setTags] = useState([])
  const [tagKeyword, setTagKeyword] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [traitsRef, setTraitsRef] = useState([])
  const [traitDetails, setTraitDetails] = useState([])
  const [characters, setCharacters] = useState([])
  const [characterDetails, setCharacterDetails] = useState({})
  const [portraitLoadErrorIds, setPortraitLoadErrorIds] = useState([])
  const [selectedCharacterId, setSelectedCharacterId] = useState('')
  const [traitEditorText, setTraitEditorText] = useState('')
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [loadingRoles, setLoadingRoles] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [editorMode, setEditorMode] = useState('edit')
  const [localizedNameEditorText, setLocalizedNameEditorText] = useState('')
  const [localizedDescriptionEditorText, setLocalizedDescriptionEditorText] = useState('')
  const [traitKeyword, setTraitKeyword] = useState('')
  const [selectedTraitId, setSelectedTraitId] = useState('')
  const [traitDraftId, setTraitDraftId] = useState('')
  const [traitDraftModifiers, setTraitDraftModifiers] = useState([])
  const [traitLocalizedNameDraft, setTraitLocalizedNameDraft] = useState('')
  const [traitLocalizedDescriptionDraft, setTraitLocalizedDescriptionDraft] = useState('')
  const [traitSaving, setTraitSaving] = useState(false)
  const [portraitModalOpen, setPortraitModalOpen] = useState(false)
  const [portraitSourceDataUrl, setPortraitSourceDataUrl] = useState('')
  const [portraitPreviewDataUrl, setPortraitPreviewDataUrl] = useState('')
  const [portraitZoom, setPortraitZoom] = useState(1)
  const [portraitOffsetX, setPortraitOffsetX] = useState(0)
  const [portraitOffsetY, setPortraitOffsetY] = useState(0)
  const [portraitImporting, setPortraitImporting] = useState(false)
  const [loadingPortraits, setLoadingPortraits] = useState(false)
  const [newCharacter, setNewCharacter] = useState({
    id: '',
    displayName: '',
    roleType: 'advisor',
    traits: '',
  })

  const latestLoadRequestId = useRef(0)
  const portraitCanvasRef = useRef(null)
  const portraitImageRef = useRef(null)
  const portraitDragRef = useRef({ active: false, lastX: 0, lastY: 0 })

  const selectedCharacter = useMemo(() => characterDetails[selectedCharacterId] ?? null, [characterDetails, selectedCharacterId])

  const characterTraits = useMemo(
    () =>
      traitEditorText
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    [traitEditorText],
  )

  const filteredTraitHints = useMemo(() => {
    const keyword = traitKeyword.trim().toLowerCase()
    if (!keyword) {
      return traitsRef.slice(0, 160)
    }
    return traitsRef
      .filter((item) => item.id.toLowerCase().includes(keyword) || item.text.toLowerCase().includes(keyword))
      .slice(0, 200)
  }, [traitKeyword, traitsRef])

  const filteredTags = useMemo(() => {
    const keyword = tagKeyword.trim().toLowerCase()
    if (!keyword) {
      return tags
    }
    return tags.filter((item) => {
      const a = item.tag.toLowerCase()
      const b = item.file.toLowerCase()
      return a.includes(keyword) || b.includes(keyword)
    })
  }, [tags, tagKeyword])

  const visibleTags = useMemo(() => {
    if (!selectedTag || filteredTags.some((item) => item.tag === selectedTag)) {
      return filteredTags
    }
    const selected = tags.find((item) => item.tag === selectedTag)
    return selected ? [selected, ...filteredTags] : filteredTags
  }, [filteredTags, selectedTag, tags])

  const selectedTraitDetail = useMemo(
    () => traitDetails.find((item) => item.id === selectedTraitId) ?? null,
    [traitDetails, selectedTraitId],
  )
  const traitDisplayNameMap = useMemo(
    () => new Map(traitDetails.map((item) => [item.id, item.localizedName || item.id])),
    [traitDetails],
  )

  const fetchJson = useCallback(async (url, options) => {
    const controller = new AbortController()
    const timeoutMs = options?.timeoutMs ?? 120000
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('请求超时，请重试加载角色')
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(data?.error ?? `请求失败: ${response.status}`)
    }
    return data
  }, [])

  const loadTraitDetails = useCallback(async () => {
    const data = await fetchJson('/api/traits/detail')
    setTraitDetails(data)
  }, [fetchJson])

  const loadCharacterDetail = useCallback(async (tag, characterId, reload = false, includePortrait = false) => {
    if (!tag || !characterId) {
      return null
    }
    const detail = await fetchJson(`/api/characters/${characterId}?tag=${tag}${reload ? '&reload=1' : ''}${includePortrait ? '&portrait=1' : ''}`)
    setCharacterDetails((prev) => ({ ...prev, [characterId]: detail }))
    setPortraitLoadErrorIds((prev) => prev.filter((id) => id !== characterId))
    return detail
  }, [fetchJson])

  const loadCharacters = useCallback(async (tag, preferredId = '', reload = false) => {
    const requestId = latestLoadRequestId.current + 1
    latestLoadRequestId.current = requestId
    if (!tag) {
      if (requestId !== latestLoadRequestId.current) {
        return
      }
      setCharacters([])
      setCharacterDetails({})
      setSelectedCharacterId('')
      setTraitEditorText('')
      setSelectedTraitId('')
      return
    }
    const data = await fetchJson(`/api/characters?tag=${tag}${reload ? '&reload=1' : ''}`)
    if (requestId !== latestLoadRequestId.current) {
      return
    }
    setCharacters(data)
    setCharacterDetails({})
    setPortraitLoadErrorIds([])
    if (data.length > 0) {
      const current = data.find((item) => item.id === preferredId) ?? data[0]
      setSelectedCharacterId(current.id)
      setEditorMode('edit')
      const detail = await loadCharacterDetail(tag, current.id, reload, false)
      if (requestId !== latestLoadRequestId.current || !detail) {
        return
      }
      const firstTraits = detail.traitsBlocks?.[0]?.traits?.join('\n') ?? ''
      const firstTraitId = firstTraits
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean)[0] ?? ''
      setTraitEditorText(firstTraits)
      setLocalizedNameEditorText(detail.localizedName || '')
      setLocalizedDescriptionEditorText(detail.localizedDescription || '')
      setSelectedTraitId(firstTraitId)
      loadCharacterDetail(tag, current.id, reload, true).catch(() => {})
    } else {
      setSelectedCharacterId('')
      setTraitEditorText('')
      setLocalizedNameEditorText('')
      setLocalizedDescriptionEditorText('')
      setSelectedTraitId('')
    }
  }, [fetchJson, loadCharacterDetail])

  const triggerLoadCharacters = useCallback(async (tag, preferredId = '') => {
    if (!tag) {
      setMessage('请先选择国家TAG')
      return
    }
    setLoadingRoles(true)
    setLoadingProgress(5)
    setMessage('')
    const timer = setInterval(() => {
      setLoadingProgress((prev) => {
        if (prev >= 90) {
          return prev
        }
        return prev + 8
      })
    }, 120)
    try {
      await loadCharacters(tag, preferredId, true)
      setLoadingProgress(100)
    } catch (error) {
      if (error.message.includes('请求超时')) {
        try {
          await loadCharacters(tag, preferredId, false)
          setLoadingProgress(100)
          setMessage('热加载超时，已切换为缓存加载结果')
          return
        } catch (fallbackError) {
          setMessage(fallbackError.message)
          return
        }
      }
      setMessage(error.message)
    } finally {
      clearInterval(timer)
      setTimeout(() => {
        setLoadingRoles(false)
        setLoadingProgress(0)
      }, 240)
    }
  }, [loadCharacters])

  useEffect(() => {
    const run = async () => {
      const [metaData, tagsData, traitsData] = await Promise.all([
        fetchJson('/api/meta'),
        fetchJson('/api/tags'),
        fetchJson('/api/traits'),
      ])
      setMeta(metaData)
      setTags(tagsData)
      setTraitsRef(traitsData)
      await loadTraitDetails()
      const tag = tagsData[0]?.tag ?? ''
      setSelectedTag(tag)
    }
    run().catch((error) => setMessage(error.message))
  }, [fetchJson, loadTraitDetails])

  useEffect(() => {
    if (!selectedCharacter) {
      setTraitEditorText('')
      setLocalizedNameEditorText('')
      setLocalizedDescriptionEditorText('')
      setSelectedTraitId('')
      return
    }
    const text = selectedCharacter.traitsBlocks?.[0]?.traits?.join('\n') ?? ''
    const firstTrait = text
      .split(/[\s,，]+/)
      .map((item) => item.trim())
      .filter(Boolean)[0] ?? ''
    setTraitEditorText(text)
    setLocalizedNameEditorText(selectedCharacter.localizedName || '')
    setLocalizedDescriptionEditorText(selectedCharacter.localizedDescription || '')
    setSelectedTraitId(firstTrait)
  }, [selectedCharacter])

  useEffect(() => {
    const detail = traitDetails.find((item) => item.id === selectedTraitId)
    if (!detail) {
      setTraitDraftId(selectedTraitId)
      setTraitDraftModifiers([])
      setTraitLocalizedNameDraft(selectedTraitId)
      setTraitLocalizedDescriptionDraft('')
      return
    }
    setTraitDraftId(detail.id)
    setTraitDraftModifiers(detail.modifiers.map((item) => ({ key: item.key, value: String(item.value) })))
    setTraitLocalizedNameDraft(detail.localizedName || detail.id)
    setTraitLocalizedDescriptionDraft(detail.localizedDescription || '')
  }, [selectedTraitId, traitDetails])

  const onChangeTag = (event) => {
    const next = event.target.value
    setSelectedTag(next)
    setCharacters([])
    setCharacterDetails({})
    setSelectedCharacterId('')
    setTraitEditorText('')
    setLocalizedNameEditorText('')
    setLocalizedDescriptionEditorText('')
    setSelectedTraitId('')
    setEditorMode('edit')
    setMessage('')
  }

  const saveCharacter = async () => {
    if (!selectedCharacter) {
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const localizedDescription = localizedDescriptionEditorText.trim()
      await fetchJson(`/api/characters/${selectedCharacter.id}/localization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localizedName: localizedNameEditorText.trim() }),
      })
      if (localizedDescription) {
        await fetchJson(`/api/characters/${selectedCharacter.id}/description-localization`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ localizedDescription }),
        })
      }
      await fetchJson(`/api/characters/${selectedCharacter.id}/traits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traits: characterTraits }),
      })
      setMessage(`已保存 ${selectedCharacter.id} 的名称/介绍本地化与主特质块`)
      await triggerLoadCharacters(selectedTag, selectedCharacter.id)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  const saveTraitDefinition = async () => {
    const id = traitDraftId.trim()
    if (!id) {
      setMessage('请先输入特质ID')
      return
    }
    const modifiers = traitDraftModifiers
      .map((item) => ({ key: item.key.trim(), value: Number(item.value) }))
      .filter((item) => item.key && Number.isFinite(item.value))
    setTraitSaving(true)
    setMessage('')
    try {
      await fetchJson('/api/traits/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, modifiers }),
      })
      await fetchJson(`/api/traits/${id}/localization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localizedName: traitLocalizedNameDraft.trim() || id,
          localizedDescription: traitLocalizedDescriptionDraft.trim(),
        }),
      })
      await loadTraitDetails()
      setSelectedTraitId(id)
      setMessage(`已保存特质 ${id} 及其本地化`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setTraitSaving(false)
    }
  }

  const createCharacter = async (event) => {
    event.preventDefault()
    if (!selectedTag) {
      return
    }
    setCreating(true)
    setMessage('')
    try {
      const traits = newCharacter.traits
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean)
      await fetchJson('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newCharacter.id.trim(),
          displayName: newCharacter.displayName.trim(),
          roleType: newCharacter.roleType,
          tag: selectedTag,
          traits,
        }),
      })
      setMessage(`已创建角色 ${newCharacter.id.trim()} 并分配到 ${selectedTag}`)
      setNewCharacter({
        id: '',
        displayName: '',
        roleType: 'advisor',
        traits: '',
      })
      await triggerLoadCharacters(selectedTag)
      setEditorMode('edit')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setCreating(false)
    }
  }

  const appendTraitText = (current, traitId) => {
    const exists = current
      .split(/[\s,，]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .includes(traitId)
    if (exists || !traitId) {
      return current
    }
    return current.trim() ? `${current.trim()}\n${traitId}` : traitId
  }

  const removeTraitText = (current, traitId) =>
    current
      .split(/[\s,，]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => item !== traitId)
      .join('\n')

  const appendTraitToEditor = (traitId) => {
    if (editorMode === 'create') {
      setNewCharacter((prev) => ({ ...prev, traits: appendTraitText(prev.traits, traitId) }))
      return
    }
    setTraitEditorText((prev) => appendTraitText(prev, traitId))
    setSelectedTraitId(traitId)
  }

  const removeTraitFromEditor = (traitId) => {
    if (editorMode === 'create') {
      setNewCharacter((prev) => ({ ...prev, traits: removeTraitText(prev.traits, traitId) }))
      return
    }
    setTraitEditorText((prev) => removeTraitText(prev, traitId))
    if (selectedTraitId === traitId) {
      const next = characterTraits.filter((item) => item !== traitId)[0] ?? ''
      setSelectedTraitId(next)
    }
  }

  const openCreateEditor = () => {
    setEditorMode('create')
    setSelectedCharacterId('')
    setTraitEditorText('')
    setLocalizedNameEditorText('')
    setLocalizedDescriptionEditorText('')
    setSelectedTraitId('')
    setMessage('')
  }

  const renderPortraitPreview = useCallback((img) => {
    const canvas = portraitCanvasRef.current
    if (!canvas || !img) {
      return
    }
    canvas.width = defaultPortraitWidth
    canvas.height = defaultPortraitHeight
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, defaultPortraitWidth, defaultPortraitHeight)
    const scale = Math.max(defaultPortraitWidth / img.width, defaultPortraitHeight / img.height) * portraitZoom
    const drawWidth = img.width * scale
    const drawHeight = img.height * scale
    const x = (defaultPortraitWidth - drawWidth) / 2 + portraitOffsetX * (defaultPortraitWidth / 2)
    const y = (defaultPortraitHeight - drawHeight) / 2 + portraitOffsetY * (defaultPortraitHeight / 2)
    ctx.drawImage(img, x, y, drawWidth, drawHeight)
    setPortraitPreviewDataUrl(canvas.toDataURL('image/png'))
  }, [defaultPortraitHeight, defaultPortraitWidth, portraitOffsetX, portraitOffsetY, portraitZoom])

  const clampOffset = (value) => {
    if (value > 1) return 1
    if (value < -1) return -1
    return value
  }

  const onPortraitCanvasPointerDown = (event) => {
    portraitDragRef.current = {
      active: true,
      lastX: event.clientX,
      lastY: event.clientY,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPortraitCanvasPointerMove = (event) => {
    if (!portraitDragRef.current.active) {
      return
    }
    const dx = event.clientX - portraitDragRef.current.lastX
    const dy = event.clientY - portraitDragRef.current.lastY
    portraitDragRef.current.lastX = event.clientX
    portraitDragRef.current.lastY = event.clientY
    setPortraitOffsetX((prev) => clampOffset(prev + dx / (defaultPortraitWidth / 2)))
    setPortraitOffsetY((prev) => clampOffset(prev + dy / (defaultPortraitHeight / 2)))
  }

  const onPortraitCanvasPointerUp = () => {
    portraitDragRef.current.active = false
  }

  useEffect(() => {
    if (!portraitSourceDataUrl) {
      return
    }
    const img = new Image()
    img.onload = () => {
      portraitImageRef.current = img
      renderPortraitPreview(img)
    }
    img.src = portraitSourceDataUrl
  }, [portraitSourceDataUrl, renderPortraitPreview])

  useEffect(() => {
    if (!portraitImageRef.current) {
      return
    }
    renderPortraitPreview(portraitImageRef.current)
  }, [portraitZoom, portraitOffsetX, portraitOffsetY, renderPortraitPreview])

  const onSelectPortraitFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    const lowerName = file.name.toLowerCase()
    const isDds = lowerName.endsWith('.dds') || file.type.includes('dds')
    if (
      !isDds &&
      !file.type.includes('png') &&
      !file.type.includes('jpeg') &&
      !file.type.includes('jpg')
    ) {
      setMessage('仅支持导入 .png / .jpg / .jpeg / .dds')
      return
    }
    if (isDds) {
      if (!selectedCharacter) {
        setMessage('请先选择角色')
        return
      }
      setPortraitImporting(true)
      setMessage('')
      const reader = new FileReader()
      reader.onload = async () => {
        const buffer = new Uint8Array(reader.result)
        let binary = ''
        const chunkSize = 0x8000
        for (let i = 0; i < buffer.length; i += chunkSize) {
          binary += String.fromCharCode(...buffer.subarray(i, i + chunkSize))
        }
        const ddsBase64 = btoa(binary)
        try {
          await fetchJson(`/api/characters/${selectedCharacter.id}/portrait/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ddsBase64 }),
          })
          await triggerLoadCharacters(selectedTag, selectedCharacter.id)
          setMessage(`已导入并替换 ${selectedCharacter.id} 的 DDS 肖像`)
        } catch (error) {
          setMessage(error.message)
        } finally {
          setPortraitImporting(false)
        }
      }
      reader.readAsArrayBuffer(file)
      event.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPortraitSourceDataUrl(String(reader.result))
      setPortraitZoom(1)
      setPortraitOffsetX(0)
      setPortraitOffsetY(0)
      setPortraitModalOpen(true)
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const submitPortraitImport = async () => {
    if (!selectedCharacter || !portraitPreviewDataUrl) {
      return
    }
    setPortraitImporting(true)
    setMessage('')
    try {
      await fetchJson(`/api/characters/${selectedCharacter.id}/portrait/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: portraitPreviewDataUrl }),
      })
      await triggerLoadCharacters(selectedTag, selectedCharacter.id)
      setPortraitModalOpen(false)
      setMessage(`已导入并替换 ${selectedCharacter.id} 角色肖像`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setPortraitImporting(false)
    }
  }

  const loadPortraitsForList = async () => {
    if (!selectedTag || characters.length === 0) {
      return
    }
    setLoadingPortraits(true)
    setMessage('')
    try {
      const ids = characters.map((item) => item.id)
      const concurrency = 4
      for (let i = 0; i < ids.length; i += concurrency) {
        const group = ids.slice(i, i + concurrency)
        await Promise.all(group.map((id) => loadCharacterDetail(selectedTag, id, false, true)))
      }
      setMessage(`已加载 ${ids.length} 个角色肖像`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoadingPortraits(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1680px] p-4 md:p-6">
        <header className="mb-6 rounded-lg border border-slate-700 bg-slate-900 p-4">
          <h1 className="text-2xl font-bold text-cyan-300">HOI4 国家角色编辑器</h1>
          <p className="mt-2 text-sm text-slate-300">选择国家TAG查看角色，支持编辑角色主特质块并新增角色</p>
          <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
            <div>Mod路径: {meta?.modRoot ?? '加载中...'}</div>
            <div>游戏路径: {meta?.gameRoot ?? '加载中...'}</div>
          </div>
        </header>

        <section className="mb-4 rounded-lg border border-slate-700 bg-slate-900 p-4">
          <label className="mb-2 block text-sm font-medium text-slate-300" htmlFor="tag-select">
            国家TAG
          </label>
          <input
            value={tagKeyword}
            onChange={(event) => setTagKeyword(event.target.value)}
            className="mb-2 w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm outline-none ring-cyan-400 focus:ring"
            placeholder="搜索 TAG 或国家文件名"
          />
          <select
            id="tag-select"
            value={selectedTag}
            onChange={onChangeTag}
            className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm outline-none ring-cyan-400 focus:ring"
          >
            {visibleTags.map((item) => (
              <option key={item.tag} value={item.tag}>
                {item.tag} - {item.file} ({item.source})
              </option>
            ))}
          </select>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => triggerLoadCharacters(selectedTag)}
              disabled={!selectedTag || loadingRoles}
              className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-cyan-900"
            >
              {loadingRoles ? '加载中...' : '加载角色'}
            </button>
            <div className="h-2 flex-1 overflow-hidden rounded bg-slate-700">
              <div className="h-full bg-cyan-400 transition-all" style={{ width: `${loadingProgress}%` }} />
            </div>
            <div className="w-12 text-right text-xs text-slate-300">{loadingRoles ? `${loadingProgress}%` : '0%'}</div>
          </div>
          <div className="mt-2 text-xs text-slate-400">显示 {filteredTags.length} / {tags.length} 个 TAG</div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[420px_1fr] xl:items-stretch">
          <section className="flex min-h-[360px] flex-col rounded-lg border border-slate-700 bg-slate-900 p-3 xl:h-[calc(100vh-280px)]">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-cyan-300">角色列表 ({characters.length})</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadPortraitsForList}
                  disabled={loadingPortraits || characters.length === 0}
                  className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-900"
                >
                  {loadingPortraits ? '加载中...' : '加载肖像'}
                </button>
                <button
                  type="button"
                  onClick={openCreateEditor}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  添加角色
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
              {characters.map((item) => {
                const detail = characterDetails[item.id]
                const active = item.id === selectedCharacterId
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={async () => {
                      setEditorMode('edit')
                      setSelectedCharacterId(item.id)
                      try {
                        const loaded = await loadCharacterDetail(selectedTag, item.id, false, false)
                        if (!loaded) {
                          return
                        }
                        const firstTraits = loaded.traitsBlocks?.[0]?.traits?.join('\n') ?? ''
                        const firstTraitId = firstTraits
                          .split(/[\s,，]+/)
                          .map((entry) => entry.trim())
                          .filter(Boolean)[0] ?? ''
                        setTraitEditorText(firstTraits)
                        setLocalizedNameEditorText(loaded.localizedName || '')
                        setLocalizedDescriptionEditorText(loaded.localizedDescription || '')
                        setSelectedTraitId(firstTraitId)
                        loadCharacterDetail(selectedTag, item.id, false, true).catch(() => {})
                      } catch (error) {
                        setMessage(error.message)
                      }
                    }}
                    className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition ${
                      active ? 'border-cyan-400 bg-cyan-950/40' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                    }`}
                  >
                    {(detail?.portraitUrl || item.portraitUrl) && !portraitLoadErrorIds.includes(item.id) ? (
                      <img
                        src={detail?.portraitUrl || item.portraitUrl}
                        alt={detail?.localizedName || item.localizedName}
                        onError={() => {
                          setPortraitLoadErrorIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]))
                        }}
                        className="h-14 w-14 rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded bg-slate-700 text-xs text-slate-300">无头像</div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{detail?.localizedName || item.localizedName || item.id}</div>
                      <div className="truncate text-xs text-slate-400">{item.id}</div>
                      <div className="truncate text-xs text-amber-300">{item.types.join(', ')}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="min-h-[360px] rounded-lg border border-slate-700 bg-slate-900 p-4 xl:h-[calc(100vh-280px)] xl:overflow-auto">
            {editorMode === 'create' ? (
              <>
                <h2 className="text-lg font-semibold text-cyan-300">集成式角色编辑器 · 新增角色</h2>
                <form className="mt-4 space-y-3" onSubmit={createCharacter}>
                  <input
                    value={newCharacter.id}
                    onChange={(event) => setNewCharacter((prev) => ({ ...prev, id: event.target.value }))}
                    className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm outline-none ring-cyan-400 focus:ring"
                    placeholder="角色ID，如 PW_new_minister"
                    required
                  />
                  <input
                    value={newCharacter.displayName}
                    onChange={(event) => setNewCharacter((prev) => ({ ...prev, displayName: event.target.value }))}
                    className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm outline-none ring-cyan-400 focus:ring"
                    placeholder="本地化名称（中文）"
                    required
                  />
                  <select
                    value={newCharacter.roleType}
                    onChange={(event) => setNewCharacter((prev) => ({ ...prev, roleType: event.target.value }))}
                    className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm outline-none ring-cyan-400 focus:ring"
                  >
                    <option value="advisor">advisor</option>
                    <option value="country_leader">country_leader</option>
                  </select>
                  <textarea
                    value={newCharacter.traits}
                    onChange={(event) => setNewCharacter((prev) => ({ ...prev, traits: event.target.value }))}
                    className="h-36 w-full rounded-md border border-slate-600 bg-slate-800 p-3 text-sm outline-none ring-cyan-400 focus:ring"
                    placeholder="初始traits，空格或换行分隔"
                  />
                  <div className="rounded-md border border-slate-700 bg-slate-800 p-2">
                    <div className="mb-2 text-xs text-slate-300">角色特质列表</div>
                    <div className="flex flex-wrap gap-2">
                      {newCharacter.traits
                        .split(/[\s,，]+/)
                        .map((item) => item.trim())
                        .filter(Boolean)
                        .map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => removeTraitFromEditor(item)}
                            className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-100 hover:bg-slate-600"
                          >
                            {item} ×
                          </button>
                        ))}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={creating}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-900"
                  >
                    {creating ? '创建中...' : `添加到 ${selectedTag || 'TAG'}`}
                  </button>
                </form>
              </>
            ) : !selectedCharacter ? (
              <div className="text-sm text-slate-400">请在左侧选择角色，或点击“添加角色”。</div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-cyan-300">集成式角色编辑器 · 编辑角色</h2>
                <div className="mt-4 grid gap-4 rounded-md border border-slate-700 bg-slate-800 p-3 md:grid-cols-[1fr_150px]">
                  <div className="grid gap-2 text-sm text-slate-200">
                    <div>角色ID: {selectedCharacter.id}</div>
                    <div>名称键值: {selectedCharacter.nameToken || '-'}</div>
                    <div>类型: {selectedCharacter.types.join(', ')}</div>
                    <div>头像Sprite: {selectedCharacter.portraitSprite || '-'}</div>
                    <div>
                      <label className="mt-1 inline-block cursor-pointer rounded-md bg-cyan-600 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500">
                      导入肖像（PNG/JPG/DDS）
                        <input
                          type="file"
                        accept=".png,.jpg,.jpeg,.dds,image/png,image/jpeg"
                          className="hidden"
                          onChange={onSelectPortraitFile}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="flex items-start justify-center md:justify-end">
                    {selectedCharacter.portraitUrl && !portraitLoadErrorIds.includes(selectedCharacter.id) ? (
                      <img
                        src={selectedCharacter.portraitUrl}
                        alt={selectedCharacter.localizedName || selectedCharacter.id}
                        onError={() => {
                          setPortraitLoadErrorIds((prev) =>
                            prev.includes(selectedCharacter.id) ? prev : [...prev, selectedCharacter.id],
                          )
                        }}
                        className="h-[140px] w-[104px] rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-[140px] w-[104px] items-center justify-center rounded bg-slate-700 text-xs text-slate-300">
                        无头像
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <label className="mb-2 block text-sm font-medium text-slate-300">本地化名称（中文）</label>
                  <input
                    value={localizedNameEditorText}
                    onChange={(event) => setLocalizedNameEditorText(event.target.value)}
                    className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm outline-none ring-cyan-400 focus:ring"
                    placeholder="输入本地化名称"
                  />
                </div>
                <div className="mt-4">
                  <label className="mb-2 block text-sm font-medium text-slate-300">角色介绍本地化（中文）</label>
                  <textarea
                    value={localizedDescriptionEditorText}
                    onChange={(event) => setLocalizedDescriptionEditorText(event.target.value)}
                    className="h-24 w-full rounded-md border border-slate-600 bg-slate-800 p-3 text-sm outline-none ring-cyan-400 focus:ring"
                    placeholder="输入角色介绍描述"
                  />
                </div>

                <div className="mt-4">
                  <label className="mb-2 block text-sm font-medium text-slate-300">角色特质列表</label>
                  <div className="rounded-md border border-slate-700 bg-slate-800 p-2">
                    <div className="flex flex-wrap gap-2">
                      {characterTraits.map((item) => (
                        <div key={item} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedTraitId(item)}
                            className={`rounded px-2 py-1 text-xs ${
                              selectedTraitId === item
                                ? 'bg-cyan-700 text-white'
                                : 'bg-slate-700 text-slate-100 hover:bg-slate-600'
                            }`}
                          >
                            {traitDisplayNameMap.get(item) ?? item}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTraitFromEditor(item)}
                            className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={saveCharacter}
                    className="mt-3 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-cyan-900"
                  >
                    {saving ? '保存中...' : '保存角色'}
                  </button>
                </div>

                <div className="mt-4 rounded-md border border-slate-700 bg-slate-800 p-3">
                  <div className="mb-2 text-sm font-semibold text-amber-300">特质内容 {selectedTraitDetail ? `(${selectedTraitDetail.id})` : ''}</div>
                  <input
                    value={traitLocalizedNameDraft}
                    onChange={(event) => setTraitLocalizedNameDraft(event.target.value)}
                    className="mb-2 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm outline-none ring-cyan-400 focus:ring"
                    placeholder="特质名称本地化（中文）"
                  />
                  <textarea
                    value={traitLocalizedDescriptionDraft}
                    onChange={(event) => setTraitLocalizedDescriptionDraft(event.target.value)}
                    className="mb-2 h-20 w-full rounded-md border border-slate-600 bg-slate-900 p-3 text-xs outline-none ring-cyan-400 focus:ring"
                    placeholder="特质介绍本地化（可选）"
                  />
                  <input
                    value={traitDraftId}
                    onChange={(event) => setTraitDraftId(event.target.value)}
                    className="mb-2 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm outline-none ring-cyan-400 focus:ring"
                    placeholder="特质ID（可新建）"
                  />
                  <div className="space-y-2">
                    {traitDraftModifiers.map((item, index) => (
                      <div key={`${index}-${item.key}`} className="grid grid-cols-[1fr_120px_48px] gap-2">
                        <input
                          value={item.key}
                          onChange={(event) =>
                            setTraitDraftModifiers((prev) =>
                              prev.map((row, i) => (i === index ? { ...row, key: event.target.value } : row)),
                            )
                          }
                          className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-xs outline-none ring-cyan-400 focus:ring"
                          placeholder="modifier key"
                        />
                        <input
                          value={item.value}
                          onChange={(event) =>
                            setTraitDraftModifiers((prev) =>
                              prev.map((row, i) => (i === index ? { ...row, value: event.target.value } : row)),
                            )
                          }
                          className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-xs outline-none ring-cyan-400 focus:ring"
                          placeholder="value"
                        />
                        <button
                          type="button"
                          onClick={() => setTraitDraftModifiers((prev) => prev.filter((_, i) => i !== index))}
                          className="rounded-md bg-slate-700 px-2 py-2 text-xs text-slate-100 hover:bg-slate-600"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTraitDraftModifiers((prev) => [...prev, { key: '', value: '0' }])}
                      className="rounded-md bg-slate-700 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-600"
                    >
                      新增modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => appendTraitToEditor(traitDraftId.trim())}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500"
                    >
                      加入角色特质列表
                    </button>
                    <button
                      type="button"
                      disabled={traitSaving}
                      onClick={saveTraitDefinition}
                      className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500 disabled:bg-cyan-900"
                    >
                      {traitSaving ? '保存中...' : '保存特质定义'}
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="mt-4">
              <div className="mb-2 text-sm font-semibold text-amber-300">特质提词器（可搜索）</div>
              <input
                value={traitKeyword}
                onChange={(event) => setTraitKeyword(event.target.value)}
                className="mb-2 w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm outline-none ring-cyan-400 focus:ring"
                placeholder="搜索 trait id 或描述"
              />
              <div className="max-h-64 space-y-1 overflow-auto rounded border border-slate-700 bg-slate-800 p-2 text-xs">
                {filteredTraitHints.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => appendTraitToEditor(item.id)}
                    className="block w-full rounded px-2 py-1 text-left hover:bg-slate-700"
                  >
                    <span className="text-cyan-300">{item.id}</span>
                    <span className="text-slate-300"> - {item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        {portraitModalOpen ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">
            <div className="w-full max-w-3xl rounded-lg border border-slate-700 bg-slate-900 p-4">
              <div className="mb-3 text-lg font-semibold text-cyan-300">编辑肖像（默认分辨率 156x210）</div>
              <div className="grid gap-4 md:grid-cols-[1fr_240px]">
                <div>
                  <canvas
                    ref={portraitCanvasRef}
                    onPointerDown={onPortraitCanvasPointerDown}
                    onPointerMove={onPortraitCanvasPointerMove}
                    onPointerUp={onPortraitCanvasPointerUp}
                    onPointerCancel={onPortraitCanvasPointerUp}
                    className="w-full cursor-grab rounded border border-slate-700 bg-slate-800 active:cursor-grabbing"
                    style={{ touchAction: 'none' }}
                  />
                  <div className="mt-1 text-xs text-slate-400">提示：可直接拖动图片进行裁剪定位</div>
                </div>
                <div className="space-y-3">
                  <label className="block text-xs text-slate-300">
                    缩放
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="0.01"
                      value={portraitZoom}
                      onChange={(event) => setPortraitZoom(Number(event.target.value))}
                      className="mt-1 w-full"
                    />
                  </label>
                  <label className="block text-xs text-slate-300">
                    水平裁剪
                    <input
                      type="range"
                      min="-1"
                      max="1"
                      step="0.01"
                      value={portraitOffsetX}
                      onChange={(event) => setPortraitOffsetX(Number(event.target.value))}
                      className="mt-1 w-full"
                    />
                  </label>
                  <label className="block text-xs text-slate-300">
                    垂直裁剪
                    <input
                      type="range"
                      min="-1"
                      max="1"
                      step="0.01"
                      value={portraitOffsetY}
                      onChange={(event) => setPortraitOffsetY(Number(event.target.value))}
                      className="mt-1 w-full"
                    />
                  </label>
                  {portraitPreviewDataUrl ? (
                    <img src={portraitPreviewDataUrl} alt="预览" className="h-[140px] w-[104px] rounded border border-slate-700 object-cover" />
                  ) : null}
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPortraitModalOpen(false)}
                  className="rounded-md bg-slate-700 px-3 py-2 text-sm text-slate-100 hover:bg-slate-600"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={portraitImporting}
                  onClick={submitPortraitImport}
                  className="rounded-md bg-cyan-600 px-3 py-2 text-sm text-white hover:bg-cyan-500 disabled:bg-cyan-900"
                >
                  {portraitImporting ? '导入中...' : '导入并一键注册GFX'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {message ? (
          <div className="mt-4 rounded-md border border-cyan-700 bg-cyan-950/40 p-3 text-sm text-cyan-200">{message}</div>
        ) : null}
      </div>
    </main>
  )
}

export default App
