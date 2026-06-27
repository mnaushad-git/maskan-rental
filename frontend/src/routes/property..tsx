import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/property/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/property/"!</div>
}
