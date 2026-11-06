'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Switch } from '@/components/ui/overlay';
import { ErrorState, PageHeader, Skeleton, Table } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Form = { id?: string; name: string; description: string; categoryId: string; isActive: boolean };
type Deleting = { kind: 'subject' | 'category'; id: string; name: string; blocker: string | null };

export default function AdminSubjects() {
  const qc = useQueryClient();
  const subjects = useQuery({ queryKey: ['admin', 'subjects'], queryFn: adminService.subjects });
  const cats = useQuery({ queryKey: ['admin', 'categories'], queryFn: adminService.categories });
  const [form, setForm] = useState<Form | null>(null);
  const [catName, setCatName] = useState('');
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin', 'subjects'] }); qc.invalidateQueries({ queryKey: ['admin', 'categories'] }); qc.invalidateQueries({ queryKey: ['public'] }); };
  const save = useMutation({
    mutationFn: (f: Form) => (f.id ? adminService.updateSubject(f.id, { name: f.name, description: f.description, categoryId: f.categoryId, isActive: f.isActive }) : adminService.createSubject({ name: f.name, description: f.description, categoryId: f.categoryId, isActive: f.isActive })),
    onSuccess: () => { toast.success('Subject saved'); setForm(null); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({ mutationFn: (s: any) => adminService.updateSubject(s.id, { name: s.name, description: s.description, categoryId: s.categoryId, isActive: !s.isActive }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const addCat = useMutation({ mutationFn: () => adminService.createCategory({ name: catName }), onSuccess: () => { setCatName(''); refresh(); toast.success('Category added'); }, onError: (e) => toast.error(errorMessage(e)) });

  const remove = useMutation({
    mutationFn: (d: Deleting) => (d.kind === 'subject' ? adminService.deleteSubject(d.id) : adminService.deleteCategory(d.id)),
    onSuccess: (_, d) => { toast.success(`${d.name} deleted`); setDeleting(null); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const askDeleteSubject = (s: any) => {
    const inUse = s._count.teachers || s._count.bookings;
    setDeleting({ kind: 'subject', id: s.id, name: s.name, blocker: inUse ? `It is used by ${s._count.teachers} topper(s) and ${s._count.bookings} booking(s), so it can't be deleted. Turn off Active to hide it from students instead.` : null });
  };
  const askDeleteCategory = (c: any) =>
    setDeleting({ kind: 'category', id: c.id, name: c.name, blocker: c._count.subjects ? `It still contains ${c._count.subjects} subject(s). Delete or move them first.` : null });

  return (
    <>
      <PageHeader title="Subjects & categories" description="Inactive subjects are hidden from students and can’t be booked; history is preserved." actions={<Button onClick={() => setForm({ name: '', description: '', categoryId: cats.data?.[0]?.id ?? '', isActive: true })}><Plus />New subject</Button>} />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {cats.data?.map((c: any) => <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[13px]">{c.name} <span className="text-muted-foreground">· {c._count.subjects}</span><button type="button" aria-label={`Delete category ${c.name}`} className="text-muted-foreground hover:text-danger" onClick={() => askDeleteCategory(c)}><X className="size-3.5" /></button></span>)}
        <form onSubmit={(e) => { e.preventDefault(); if (catName.trim()) addCat.mutate(); }} className="flex gap-2">
          <Input aria-label="New category" placeholder="New category" value={catName} onChange={(e) => setCatName(e.target.value)} className="h-8 w-44" />
          <Button size="sm" variant="secondary" type="submit" loading={addCat.isPending}>Add</Button>
        </form>
      </div>
      {subjects.isError ? <ErrorState message={errorMessage(subjects.error)} /> : !subjects.data ? <Skeleton className="h-96 rounded-2xl" /> : (
        <Table>
          <thead><tr><th>Subject</th><th>Category</th><th>Toppers</th><th>Bookings</th><th>Active</th><th /></tr></thead>
          <tbody>
            {subjects.data.map((s: any) => (
              <tr key={s.id}>
                <td><p className="font-medium">{s.name}</p><p className="line-clamp-1 max-w-md text-[12px] text-muted-foreground">{s.description}</p></td>
                <td>{s.category.name}</td>
                <td className="tabular-nums">{s._count.teachers}</td>
                <td className="tabular-nums">{s._count.bookings}</td>
                <td><Switch label={`${s.name} active`} checked={s.isActive} onCheckedChange={() => toggle.mutate(s)} /></td>
                <td className="whitespace-nowrap text-right"><Button size="sm" variant="ghost" onClick={() => setForm({ id: s.id, name: s.name, description: s.description, categoryId: s.categoryId, isActive: s.isActive })}>Edit</Button><Button size="sm" variant="ghost" className="text-danger" onClick={() => askDeleteSubject(s)}><Trash2 />Delete</Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)} title={form?.id ? 'Edit subject' : 'New subject'} footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button loading={save.isPending} disabled={!form?.name.trim() || !form?.categoryId} onClick={() => form && save.mutate(form)}>Save</Button></>}>
        {form && (
          <div className="space-y-4">
            <Field label="Name" htmlFor="sub-name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Category" htmlFor="sub-cat"><Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{cats.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Description" htmlFor="sub-desc"><Textarea maxLength={600} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting?.blocker ? `Can't delete ${deleting.name}` : `Delete ${deleting?.name ?? ''}?`}
        description={deleting?.blocker ?? 'This cannot be undone.'}
        footer={deleting?.blocker ? <Button variant="secondary" onClick={() => setDeleting(null)}>Close</Button> : <><Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>Delete</Button></>}
      />
    </>
  );
}
