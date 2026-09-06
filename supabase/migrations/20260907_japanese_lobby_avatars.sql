-- Add twelve Japanese young-adult lobby characters. Safe to run more than once.
begin;

insert into public.avatar_catalog(id,display_name,gender) values
  ('m-jp-01','โซตะ','male'),('f-jp-01','ฮินะ','female'),
  ('m-jp-02','ริคุ','male'),('f-jp-02','เมอิ','female'),
  ('m-jp-03','ไคโตะ','male'),('f-jp-03','อากิระ','female'),
  ('m-jp-04','ทาคุมิ','male'),('f-jp-04','นานะ','female'),
  ('m-jp-05','ยูโตะ','male'),('f-jp-05','ซากุระ','female'),
  ('m-jp-06','ไดจิ','male'),('f-jp-06','มิซากิ','female')
on conflict (id) do update set display_name=excluded.display_name,gender=excluded.gender;

notify pgrst, 'reload schema';
commit;
