import { useState } from 'react'
import { Dialog } from './Dialog'

/** Shows the build sheet text, with Copy and Download. */
export function BuildSheetDialog({ open, text, fileName, onClose }: { open: boolean; text: string; fileName: string; onClose: () => void }) {
  const [msg, setMsg] = useState<string | null>(null)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setMsg('Copied to the clipboard.') }
    catch { setMsg('Copying was blocked. Select the text and press Ctrl+C.') }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <Dialog open={open} title="Build sheet" note="Parts, attachments, prices and checks as plain text." submitLabel="Copy" onClose={() => { setMsg(null); onClose() }} onSubmit={copy} wide>
      <textarea className="sheet" readOnly value={text} aria-label="Build sheet" onFocus={(e) => e.target.select()} />
      <div className="row-actions">
        <button type="button" className="btn" onClick={download}>Download .txt</button>
        {msg && <span className="note" role="status">{msg}</span>}
      </div>
    </Dialog>
  )
}
