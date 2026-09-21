import type { ReactNode } from 'react'

export function Skeletons({ n = 7 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div className="sk" key={i} aria-hidden="true">
          <i /><span><u /><u /></span>
        </div>
      ))}
    </>
  )
}

export function Empty({ title, children, action }: {
  title: string; children: ReactNode; action?: ReactNode
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  )
}

/** A failure the person can act on: what broke, and the likeliest fix. */
export function Failed({ title, detail, action }: {
  title: string; detail: string; action?: ReactNode
}) {
  const denied = /403|permission|not authorized|forbidden/i.test(detail)
  const noAccount = /account|not connected|resolution/i.test(detail)
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{detail}</p>
      {denied && <p>This usually means the agent or your pod role is missing a grant for it.</p>}
      {noAccount && <p>Connect an account on the Connections page and this will fill in.</p>}
      {action}
    </div>
  )
}

export function Working({ label = 'Working' }: { label?: string }) {
  return <span className="working"><span className="spin" />{label}</span>
}
