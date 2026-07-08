import { useEffect, useRef, useState } from 'react'
import { Upload, Trash2, Loader2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'

interface ProjectDoc {
  id: string
  name: string
  mime: string
  sizeBytes: number
  createdAt: string
}

interface ProjectDocsFormProps {
  channelId: string
}

/** Human-readable file size (KB / MB). */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const ACCEPT = '.pdf,.docx,.md,.markdown,.txt'

export function ProjectDocsForm({ channelId }: ProjectDocsFormProps) {
  const { showToast, t } = useApp()
  const [docs, setDocs] = useState<ProjectDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Load the channel's documents ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const initData = getTelegramInitData()
    if (!initData) { setLoading(false); return }

    fetch(`${API_BASE}/api/project-docs/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, channelId }),
    })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((data: { docs: ProjectDoc[] }) => { if (!cancelled) setDocs(data.docs ?? []) })
      .catch(() => { /* leave list empty */ })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [channelId])

  // ── Upload ────────────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast(t('channelStyle.projectDocs.uploadFailed'), 'error'); return }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('initData', initData)
      form.append('channelId', channelId)
      form.append('file', file)
      const res = await fetch(`${API_BASE}/api/project-docs/upload`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        showToast(err.error ?? t('channelStyle.projectDocs.uploadFailed'), 'error')
        return
      }
      const { doc } = await res.json() as { doc: ProjectDoc & { truncated?: boolean } }
      setDocs(prev => [doc, ...prev])
      showToast(doc.truncated
        ? t('channelStyle.projectDocs.truncated')
        : t('channelStyle.projectDocs.uploadDone'))
    } catch {
      showToast(t('channelStyle.projectDocs.uploadFailed'), 'error')
    } finally {
      setUploading(false)
    }
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset so re-selecting the same file re-triggers onChange.
    e.target.value = ''
    if (file) void handleFile(file)
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async (docId: string) => {
    if (!window.confirm(t('channelStyle.projectDocs.deleteConfirm'))) return
    const initData = getTelegramInitData()
    if (!initData) return
    setDeletingId(docId)
    try {
      const res = await fetch(`${API_BASE}/api/project-docs/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, channelId, docId }),
      })
      if (!res.ok) {
        showToast(t('channelStyle.projectDocs.deleteFailed'), 'error')
        return
      }
      setDocs(prev => prev.filter(d => d.id !== docId))
    } catch {
      showToast(t('channelStyle.projectDocs.deleteFailed'), 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-3 pt-1">
      <p className="text-[12px] leading-relaxed text-[#8A8A92]">
        {t('channelStyle.projectDocs.intro')}
      </p>

      {/* Document list */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 size={16} className="animate-spin text-[#66666E]" />
        </div>
      ) : docs.length === 0 ? (
        <p className="text-[12px] text-[#55555D] py-1">{t('channelStyle.projectDocs.empty')}</p>
      ) : (
        <div className="space-y-1.5">
          {docs.map(doc => (
            <div
              key={doc.id}
              className="flex items-center gap-2.5 rounded-[10px] bg-white/[0.04] border border-white/[0.06] px-3 py-2"
            >
              <FileText size={15} className="shrink-0 text-[#FF6A00]" />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] text-white truncate">{doc.name}</p>
                <p className="text-[10.5px] text-[#55555D]">{formatSize(doc.sizeBytes)}</p>
              </div>
              <button
                onClick={() => void handleDelete(doc.id)}
                disabled={deletingId === doc.id}
                className="shrink-0 p-1.5 rounded-[8px] text-[#66666E] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                aria-label="delete"
              >
                {deletingId === doc.id
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        onChange={onInputChange}
        className="hidden"
      />
      <Button
        variant="secondary"
        fullWidth
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading
          ? <><Loader2 size={15} className="animate-spin" /> {t('channelStyle.projectDocs.uploading')}</>
          : <><Upload size={15} /> {t('channelStyle.projectDocs.upload')}</>}
      </Button>
      <p className="text-[10.5px] text-[#44444C] text-center">
        {t('channelStyle.projectDocs.formats')}
      </p>
    </div>
  )
}
