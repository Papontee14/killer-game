export type AvatarGender = "male" | "female";

export type Avatar = {
  id: string;
  name: string;
  gender: AvatarGender;
  src: string;
};

/**
 * Public, role-neutral identities.  IDs are persisted in `players.avatar_id`,
 * so never rename an ID after it ships.
 */
export const AVATARS: readonly Avatar[] = [
  ["m-sea-01", "อรุณ", "male"], ["f-sea-01", "มะลิ", "female"],
  ["m-sea-02", "วิน", "male"], ["f-sea-02", "ฝน", "female"],
  ["m-sea-03", "ภพ", "male"], ["f-sea-03", "ลิน", "female"],
  ["m-sea-04", "ก้อง", "male"], ["f-sea-04", "ดาว", "female"],
  ["m-sea-05", "ชัย", "male"], ["f-sea-05", "พิม", "female"],
  ["m-sea-06", "ปกรณ์", "male"], ["f-sea-06", "ริน", "female"],
  ["m-ea-01", "ฮารุ", "male"], ["f-ea-01", "ยูนะ", "female"],
  ["m-ea-02", "เรน", "male"], ["f-ea-02", "มีนา", "female"],
  ["m-ea-03", "เคน", "male"], ["f-ea-03", "ซูบิน", "female"],
  ["m-ea-04", "จุน", "male"], ["f-ea-04", "อาโออิ", "female"],
  ["m-sa-01", "อาร์ยัน", "male"], ["f-sa-01", "อันยา", "female"],
  ["m-sa-02", "วิกรม", "male"], ["f-sa-02", "คิรัน", "female"],
  ["m-world-01", "เอไล", "male"], ["f-world-01", "อามารา", "female"],
  ["m-world-02", "โอลิเวอร์", "male"], ["f-world-02", "โซเฟีย", "female"],
  ["m-world-03", "ซามีร์", "male"], ["f-world-03", "เลย์ลา", "female"],
  ["m-world-04", "มาเตโอ", "male"], ["f-world-04", "คามิลา", "female"],
  ["m-jp-01", "โซตะ", "male"], ["f-jp-01", "ฮินะ", "female"],
  ["m-jp-02", "ริคุ", "male"], ["f-jp-02", "เมอิ", "female"],
  ["m-jp-03", "ไคโตะ", "male"], ["f-jp-03", "อากิระ", "female"],
  ["m-jp-04", "ทาคุมิ", "male"], ["f-jp-04", "นานะ", "female"],
  ["m-jp-05", "ยูโตะ", "male"], ["f-jp-05", "ซากุระ", "female"],
  ["m-jp-06", "ไดจิ", "male"], ["f-jp-06", "มิซากิ", "female"],
].map(([id, name, gender]) => ({
  id,
  name,
  gender: gender as AvatarGender,
  src: `/pixel/characters/${id}.webp`,
}));

export const AVATAR_IDS = AVATARS.map((avatar) => avatar.id);
export const avatarById = new Map(AVATARS.map((avatar) => [avatar.id, avatar]));
