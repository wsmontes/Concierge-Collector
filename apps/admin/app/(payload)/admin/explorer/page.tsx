import { CurationExplorer } from '../../../../src/components/explorer/CurationExplorer'

export default async function ExplorerPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string | string[] }>
}) {
  const resolved = await searchParams
  const collection = typeof resolved.collection === 'string' ? resolved.collection : null
  return <CurationExplorer targetCollectionId={collection} />
}