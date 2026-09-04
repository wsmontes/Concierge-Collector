import { CollectionDetailWorkspace } from '../../../../../src/components/collections/CollectionDetailWorkspace'

export default async function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CollectionDetailWorkspace collectionId={id} />
}
