import { HomeView } from '@/features/home/HomeView';
import { serverApi } from '@/services/server-api';

// Rendered per request (no API needed at build time, e.g. in Docker); API responses are
// still cached for 30 s by the fetch `revalidate` in server-api.
export const dynamic = 'force-dynamic';

/** Server component: fetches (cached, SEO-friendly) and hands data to the client view. */
export default async function HomePage() {
  const [featured, open, upcoming] = await Promise.all([
    serverApi.events('featured=true&tab=upcoming&perPage=3'),
    serverApi.events('tab=open&perPage=6'),
    serverApi.events('tab=upcoming&perPage=6'),
  ]);
  return <HomeView featured={featured?.data ?? []} open={open?.data ?? []} upcoming={upcoming?.data ?? []} />;
}
