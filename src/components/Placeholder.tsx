export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="py-16 text-center text-gray-400">
      <div className="text-3xl mb-2">🚧</div>
      <div className="font-medium text-gray-600">{title}</div>
      <div className="text-sm">Раздел в разработке</div>
    </div>
  )
}
