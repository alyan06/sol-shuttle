import type { Metadata } from 'next';
import ScheduleEditor from '@/components/ScheduleEditor';
import routeData from '@/lib/route.json';
import type { Route } from '@/lib/types.ts';

export const metadata: Metadata = { title: 'Schedule' };

export default function SchedulePage() {
  return <ScheduleEditor route={routeData as Route} />;
}
