import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventDetailView } from '@/features/events/EventDetailView';
import { serverApi } from '@/services/server-api';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const res = await serverApi.event(id);
  if (!res) return { title: 'ไม่พบกิจกรรม' };
  const description = res.data.description?.slice(0, 160) ?? undefined;
  return { title: res.data.titleTh, description, openGraph: { title: res.data.titleTh, description } };
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params;
  const res = await serverApi.event(id);
  if (!res) notFound();
  return <EventDetailView event={res.data} />;
}
