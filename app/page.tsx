import Tracker from '@/components/Tracker';
import routeData from '@/lib/route.json';
import type { Route } from '@/lib/types.ts';

export default function Page() {
  return <Tracker route={routeData as Route} />;
}
