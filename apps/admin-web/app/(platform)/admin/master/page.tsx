import { redirect } from 'next/navigation';

export default function MasterIndexPage() {
  redirect('/admin/master/facility-types');
}
