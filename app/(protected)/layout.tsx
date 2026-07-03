import Topbar from '@/components/topbar'

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar />
      <main>{children}</main>
    </>
  )
}
