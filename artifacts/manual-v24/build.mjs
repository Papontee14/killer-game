import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, '../..');
const fontCss = (await Promise.all([['Regular',400],['Bold',700]].map(async ([style,weight]) => {
  const bytes = await fs.readFile(path.join(out,'fonts',`GoogleSans-${style}.ttf`));
  return `@font-face{font-family:'Google Sans';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype');}`;
}))).join('');
const asset = async (name) => 'data:image/webp;base64,' + (await fs.readFile(path.join(root, 'public/pixel', name + '.webp'))).toString('base64');
const names = ['killer','killer-wife','police','detective','reporter','doctor','bomber','athlete','villager','host'];
const imgs = Object.fromEntries(await Promise.all(names.map(async n => [n, await asset('role-' + n)])));
const portrait = (n, cls='') => `<img class="portrait ${cls}" src="${imgs[n]}" alt="${n}">`;
const brand = await fs.readFile(path.join(root, 'components/brand.tsx'), 'utf8');
// Reuse the game's hand-set logo paths, including the blade and red accents.
const glyphs = [ ['11001','11011','11110','11100','11110','11011','11001'], ['11111','01110','01110','01110','01110','01110','11111'], ['11000','11000','11000','11000','11000','11000','11111'], ['11000','11000','11000','11000','11000','11000','11111'], ['11111','11000','11000','11110','11000','11000','11111'], ['11110','11011','11011','11110','11100','11110','11011'] ];
const lettering = glyphs.flatMap((rows,l)=>rows.flatMap((row,y)=>[...row].flatMap((v,x)=>v==='1'?[`M${6+l*24+x*4} ${4+y*4}h4v4h-4Z`]:[]))).join('');
const staticPaths = [...brand.matchAll(/<path fill="[^"]+" d="[^"]+"\s*\/>/g)].map(m=>m[0]).join('');
const logo = `<svg class="logo" viewBox="0 0 156 56" shape-rendering="crispEdges" aria-label="KILLER"><path d="${lettering}" fill="#772c38" transform="translate(2 3)"/><path d="${lettering}" fill="#F3F5E9"/>${staticPaths}</svg>`;
const card = (title,body,cls='') => `<section class="card ${cls}"><h3>${title}</h3><p>${body}</p></section>`;
const note = (title,body) => `<aside class="note"><b>${title}</b><p>${body}</p></aside>`;
const role = (n,title,hp,body) => `<section class="role">${portrait(n)}<div><div class="role-heading"><h3>${title}</h3><span class="hp">${hp}</span></div><p>${body}</p></div></section>`;
const step = (n,title,body) => `<section class="step"><span class="num">${n}</span><div><h3>${title}</h3><p>${body}</p></div></section>`;
const stat = (n,label) => `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`;
const pages = [
  {slug:'start', kicker:'START HERE · เริ่มที่หน้านี้', title:'ทุกคนมีความลับ<br>ใครคือ KILLER?', sub:'เกมสืบสวนในชีวิตจริง เล่นผ่านมือถือคนละเครื่อง', cls:'intro', body:`
    <div class="hero">${portrait('killer')}${portrait('police')}<div class="hero-label"><span>KILLER SIDE</span><span>CITY SIDE</span></div></div>
    <div class="two">${card('ฝ่าย Killer','ซ่อนตัว ล่าให้ทันเวลา<br>กำจัดสาย Police หรือรอดจากโหวต','red')}${card('ฝ่าย City','เอาตัวรอด สังเกตเบาะแส<br>ร่วมกันจับ Killer ตั้งต้น','green')}</div>
    <div class="steps">${step('1','เข้าห้อง','กรอกรหัสห้อง หรือสแกน QR ที่ Host แชร์')}${step('2','เตรียมตัว','ตั้งชื่อ เลือกอวาตาร์ แล้วรอ Host เริ่มเกม')}${step('3','อ่านบทบาทลับ','ดูฝ่าย หัวใจ และความสามารถของตัวเอง')}${step('4','ลงสนาม','สังเกตผู้เล่น ใช้สกิล และติดตามเวลาในเกม')}</div>
    ${note('ชุดมาตรฐาน: 12 ผู้เล่น + Host','บทบาทพิเศษ 8 คน + Villager 4 คน · เริ่มต้น 10 ชั่วโมง<br>Host ปรับจำนวนบทบาทและระยะเวลาได้ก่อนเริ่ม')}`},
  {slug:'killer-side', kicker:'ROLE GUIDE · ฝ่าย KILLER', title:'สองคนร่วมทีม<br>หนึ่งนาฬิกาล่า', sub:'Wife อยู่ฝ่าย Killer ตั้งแต่เริ่ม แต่ยังโจมตีไม่ได้', body:`
    ${role('killer','Killer','ไม่มีแถบหัวใจ','โจมตีด้วยภาพถ่ายสด ไม่เสียหัวใจจากการโจมตีปกติ<br><b>ระเบิด Bomber ฆ่าได้</b> · เห็นเพียงเป้าหมายรอดหรือถูกกำจัด')}
    ${role('killer-wife','Killer’s Wife','♥ 1','ถูกโจมตีครั้งแรกที่ Host อนุมัติ → <b>ปลุกพลังโจมตี</b><br>ไม่ตาย และชื่อบทบาทยังเป็น Wife<br>ก่อนปลุกไม่รู้ตัว Killer; หลังปลุกทั้งคู่เห็นกัน')}
    <div class="flow"><span>Wife ถูกโจมตี</span><b>→</b><span>ปลุกพลัง</span><b>→</b><span>ร่วมล่า</span></div>
    <div class="stats">${stat('3','โจมตีที่อนุมัติ')}${stat('1','กำจัดสูงสุด')}${stat('60','นาทีย้อนหลัง')}</div>
    ${card('โควตานี้ใช้ร่วมกันทั้งทีม','นับย้อนหลังจากแต่ละเหตุการณ์ ไม่รีเซ็ตต้นชั่วโมง<br>ปลุก Wife ใช้ 1 โจมตี แต่ไม่นับเป็นการกำจัด<br>ระเบิดไม่ใช้โควตาโจมตีหรือกำจัด')}
    ${card('Hunt Clock = เส้นตายการล่า','กำจัดครั้งแรกภายใน 120 นาทีหลังเริ่มเกม<br>ทุกการกำจัดที่ยืนยันแล้ว ต่อเวลาอีก 120 นาที<br><b>ปลุก Wife และระเบิดไม่ต่อเวลา</b>','red')}
    ${note('ปกป้อง Killer ตั้งต้นให้รอด','ถ้า Killer ตั้งต้นตาย → City ชนะทันที<br>แม้ Wife ปลุกพลังแล้วและยังมีชีวิตอยู่')}`},
  {slug:'investigation', kicker:'ROLE GUIDE · ฝ่าย CITY', title:'สืบให้ถูกคน<br>รักษาสาย POLICE', sub:'ทั้งสามบทบาทมี 2 หัวใจ · ไม่มีเกราะติดตัว', body:`
    ${role('police','Police','♥ 2','<b>เปิดเผยตราได้ 1 ครั้ง</b> ภายใน Final −2 ชั่วโมง<br>ทุกคนเห็นการเปิดตรา แต่ไม่เพิ่มหัวใจหรือคุ้มกัน<br>ตอนโหวต ส่งบัตรปกติ + ลำดับผู้เล่นคนอื่นแบบลับ<br>ลำดับนี้ใช้ตัดสินเฉพาะคะแนนที่เสมอกัน')}
    ${role('detective','Detective','♥ 2','<b>รับตำแหน่ง Police เมื่อ Police ตาย</b><br>ถ้ายังมีชีวิต จะรับตำแหน่งแบบไม่ประกาศสาธารณะ<br>ได้ 2 หัวใจ ตราของตนเอง และหน้าที่โหวต Police<br>ไม่มีสกิลสแกนหรือตรวจบทบาท')}
    ${role('reporter','Reporter','♥ 2','<b>ตรวจบทบาทเริ่มต้นของคนอื่นได้ 1 ครั้ง</b><br>เป้าหมายต้องมีชีวิต ใช้ก่อนปิดโจมตี<br>และต้องเหลือผู้เล่นมากกว่าครึ่งของจำนวนเริ่มต้น<br>เช่น เริ่ม 12 คน → ต้องเหลืออย่างน้อย 7 คน')}
    ${card('ข้อมูล Reporter เป็นความลับ','คนอื่นเห็นเพียงประกาศว่าใช้ความสามารถ<br>Wife ที่ปลุกแล้ว → ผลยังเป็น Wife<br>Detective ที่รับตำแหน่งแล้ว → ผลยังเป็น Detective')}
    ${note('Police ตาย ไม่จำเป็นต้องจบเกมทันที','ตรวจผู้รับตำแหน่งต่อก่อน หากไม่มี Police ที่มีชีวิต<br>ฝ่าย Killer ชนะ — เว้นแต่เกิดเงื่อนไข City ชนะก่อน')}`},
  {slug:'support-survival', kicker:'ROLE GUIDE · ฝ่าย CITY', title:'ช่วยเพื่อนให้รอด<br>ทุกหัวใจมีค่า', sub:'รู้ความสามารถของตัวเอง ก่อนกดใช้กับใคร', cls:'support', body:`
    ${role('doctor','Doctor','♥ 2','รักษาคนอื่นที่มีชีวิต <b>+1 หัวใจ</b> ไม่เกินค่าสูงสุด<br><b>4 ครั้งต่อเกม</b> · คูลดาวน์ = เวลารอก่อนใช้ครั้งต่อไป<br>รอ 90 นาที นับจากกดใช้แต่ละครั้ง<br>ห้ามรักษาตัวเอง ไม่ชุบชีวิต ไม่ย้อนการปลุก Wife<br>ไม่ต่อเวลาคุ้มกัน · เป้าหมายเต็มหรือเป็น Killer<br>ที่โจมตีได้ก็เสียสิทธิ์และต้องรอ แม้รักษาไม่เกิดผล')}
    ${card('Doctor ไม่เห็นว่ารักษาสำเร็จหรือไม่','สาธารณะเห็นแค่ “Doctor รักษา [ชื่อ]”<br>หากผู้รักษาหรือเป้าหมายตายจากเหตุการณ์ก่อนหน้า<br>การรักษาที่รับไว้จะไม่มีผล','small')}
    ${role('bomber','Bomber','♥ 2','ถูก Killer ฆ่า → เปิดบทบาทและระเบิด<br>Host ดูภาพ เลือกเหยื่อใกล้ที่สุดที่ยังมีชีวิต 0–1 คน<br><b>ระเบิดข้ามหัวใจ ฆ่า Killer ได้</b><br>ไม่ระเบิดต่อเนื่อง และไม่ปลุกพลัง Wife')}
    <div class="two mini-roles">${card(`${portrait('athlete')}Athlete <span class="hp">♥ 3</span>`,'หัวใจมากกว่าคนอื่น<br>สังเกต เอาตัวรอด และโหวต')}${card(`${portrait('villager')}Villager <span class="hp">♥ 2</span>`,'ไม่มีสกิลพิเศษ<br>ใช้เบาะแสช่วยทีมจับ Killer')}</div>
    ${note('ยังมีชีวิต = ยังมีเสียง','ผู้เล่นฝ่าย City ทุกบทบาทร่วมโหวตได้<br>ผู้เสียชีวิตไม่มีสิทธิ์โหวต')}`},
  {slug:'attack', kicker:'HOW TO PLAY · หลักฐานและหัวใจ', title:'ถ่าย → ส่ง → รอผล<br>ยังไม่อนุมัติ ยังไม่เจ็บ', sub:'สำหรับ Killer และ Wife ที่ปลุกพลังแล้ว', body:`
    <div class="steps attack-steps">${step('1','เลือกเป้าหมายที่มีชีวิต','ดูโควตาของทีมและสถานะก่อนโจมตี')}${step('2','ถ่ายภาพจากกล้องสด','ใช้กล้องในขั้นตอนโจมตี ภาพต้องเป็นหลักฐานจริง')}${step('3','ส่งภายใน 2 นาที','นับจากเวลาถ่าย และต้องส่งก่อนปิดโจมตี')}${step('4','รอ Host ตรวจหลักฐาน','ภาพที่รอตรวจหรือถูกปฏิเสธไม่ทำให้เสียหัวใจ')}</div>
    <div class="stats">${stat('−1','หัวใจ / โจมตีปกติ')}${stat('45','นาทีคุ้มกัน')}</div>
    ${card('คุ้มกันนับจากเวลาถ่ายที่ผ่านการตรวจ','เมื่อโจมตีปกติได้รับอนุมัติ เป้าหมายได้คุ้มกัน 45 นาที<br>ภาพที่ถ่ายระหว่างคุ้มกันต้องถูกปฏิเสธ<br>ครบ 45 นาทีพอดีโจมตีได้ · เปลี่ยนเป้าหมายได้')}
    ${card('ตัวอย่าง: ภาพเวลา 10:00 ผ่านอนุมัติ','10:00 เริ่มคุ้มกัน → 10:45 โจมตีอีกครั้งได้<br>แม้ Host จะมาตรวจอนุมัติภาพตอน 10:05','green')}
    ${note('ข้อยกเว้นและคิวรอตรวจ','Killer ที่โจมตีได้ไม่รับการโจมตีปกติ; Wife ครั้งแรกคือปลุก<br>คิวรอจองโควตา: คนละไม่เกิน 2 ภาพ และทั้งทีม<br>อนุมัติ + รอ ไม่เกิน 3 ในช่วงที่นับ · ปฏิเสธแล้วคืนโควตา')}`},
  {slug:'timeline', kicker:'GAME CLOCK · เวลาที่ต้องจำ', title:'ดูนาฬิกาเกม<br>อย่ารอจนสาย', sub:'Final = เวลาสิ้นสุดช่วงเล่นที่ Host ตั้งไว้', body:`
    <div class="hunt"><div class="big-time">120<span>นาที</span></div><div><h3>Hunt Clock · เส้นตายการล่า</h3><p>เริ่มเกม → ต้องกำจัดครั้งแรกภายใน 120 นาที<br>กำจัดครั้งต่อไป → ต่ออีก 120 นาทีจากเวลากำจัด</p></div></div>
    ${card('ไม่ทัน Hunt Clock → City ชนะ','นับเฉพาะการกำจัดโดย Killer ที่ยืนยันแล้ว<br>ปลุก Wife / ระเบิด ไม่ต่อเวลา · ทันเส้นตายพอดีนับได้<br>ตรวจเส้นตายที่มาถึงภายในช่วงก่อนหรือเท่าปิดโจมตี','red')}
    <div class="timeline">${step('−2h','ก่อน Final 2 ชั่วโมง','เส้นตายเปิดตรา Police — เปิดตรงเส้นตายได้')}${step('−30','ก่อน Final 30 นาที','หยุดโจมตี ใช้สกิล และเก็บข้อมูลใหม่<br>ผู้มีชีวิตดูประวัติ/เวลาการโจมตีไม่ได้จนเกมจบ')}${step('−10','ก่อน Final 10 นาที','อภิปรายจากข้อมูลเดิม หลังเคลียร์เหตุการณ์ค้าง')}${step('0','ถึง Final','กำจัดยืนยัน 0–1 ครั้ง: City ชนะ<br>ตั้งแต่ 2 ครั้ง: เข้าสู่การโหวตลับ')}${step('+3','โหวต 3 นาทีหลังเปิดจริง','Communication Lock = ห้ามสื่อสาร<br>ห้ามโจมตี ใช้สกิล และเก็บข้อมูลใหม่ต่อเนื่อง')}</div>
    ${note('ยึดเวลาและผลในระบบ','ถ้า Host ยังตรวจไม่ครบ ระบบรอเคลียร์ก่อนตัดสิน<br>เปิดโหวตช้าก็ยังได้เต็ม 3 นาที โดยไม่เปิดโจมตีใหม่<br>เปลี่ยนความยาวเกม ไม่เปลี่ยน Hunt Clock หรือคูลดาวน์')}`},
  {slug:'vote-victory', kicker:'FINAL VOTE · ตัดสินผู้ชนะ', title:'จับ KILLER ตั้งต้น<br>คือเป้าหมายของ CITY', sub:'ทุกฝ่ายที่ยังมีชีวิตโหวตได้ · Host และผู้ตายโหวตไม่ได้', cls:'vote', body:`
    ${card('ก่อนถึง Final เกมอาจจบแล้ว','<b class="green-text">City ชนะ:</b> Killer ตั้งต้นตาย / ไม่มี Killer ที่โจมตีได้<br>เหลืออยู่ / Killer ทำการกำจัดไม่ทัน Hunt Clock<br><b class="red-text">Killer ชนะ:</b> ไม่มี Police ที่มีชีวิต หลังตรวจสืบทอด<br>ตัดสินเหยื่อระเบิดก่อน และเช็ก Killer ตั้งต้นก่อน Police')}
    <div class="gate"><b>ถึง Final</b><span>กำจัดยืนยัน 0–1 → <em>City ชนะ</em><br>กำจัดยืนยัน 2+ → เปิดโหวตลับ</span></div>
    ${card('โหวต 1 คน ภายใน 3 นาที','เลือกคนอื่นที่ยังมีชีวิต 1 คน · ส่งแล้วแก้ไม่ได้<br>ไม่ส่ง = งดออกเสียง · ห้ามสื่อสารหลังล็อก<br>ผู้ได้คะแนนสูงสุดเป็นผู้ถูกเลือก ไม่ต้องมีเสียงเกินครึ่ง')}
    <div class="results">${card('เลือก Killer ตั้งต้น','City ชนะ','green')}${card('เลือกผู้เล่นฝ่าย City','Killer Side ชนะ','red')}${card('รอบแรกเลือก Wife','เปิดเผย Wife และเอาออกจากผู้โหวต/ผู้ถูกเลือก<br>เธอไม่ตาย → โหวตรอบสุดท้ายอีก 3 นาที','amber')}</div>
    ${card('รอบสอง: ต้องเลือก Killer ตั้งต้นเท่านั้น','เลือกถูก → City ชนะ · เลือกผิด → Killer ชนะ<br>ไม่มีรอบสาม และไม่ต้องจับ Killer สองคนพร้อมกัน')}
    ${note('คะแนนเสมอ ตัดสินอย่างไร?','ใช้ลำดับลับของ Police เฉพาะคนที่เสมอกัน<br>หากไม่มี ใช้ลำดับสุ่มลับที่ระบบเตรียมไว้ก่อนโหวต<br>ตำแหน่ง Police เองอิงลำดับสุ่ม · ไม่เปิดคะแนนสด')}`},
  {slug:'host', kicker:'HOST ONLY · คู่มือผู้ดูแลเกม', title:'จัดห้องให้พร้อม<br>ตัดสินตามลำดับ', sub:'Host ดูแลหลักฐานและความเรียบร้อย ระบบตัดสินผลเกม', cls:'host', body:`
    <div class="host-banner">${portrait('host')}<div><h3>มาตรฐาน 12 ผู้เล่น + Host</h3><p>Killer, Wife, Police, Detective, Reporter,<br>Bomber, Athlete, Doctor อย่างละ 1 + Villager 4</p></div></div>
    ${step('1','ก่อนเริ่ม: เช็กคน บทบาท และเวลา','อย่างน้อย 3 คน · บทบาทรวมต้องตรงจำนวนผู้เล่น<br>Killer และ Police อย่างละ 1 · ทุกคนเลือกอวาตาร์<br>เวลา 121–2,880 นาที (ค่าเริ่มต้น 600) · เริ่มแล้วล็อกค่า')}
    ${step('2','ตรวจหลักฐานที่เก่าที่สุดก่อน','ยึดเวลาถ่ายที่ผ่านตรวจ รอช่วงส่งภาพ 2 นาที<br>หรือถึงเวลาปิดรับภาพ แล้วจึงตัดสินตามคิวระบบ<br>ตรวจภาพจริง เป้าหมาย คุ้มกัน และโควตา')}
    ${step('3','Bomber ตาย: ตัดสินระเบิดก่อน','จากภาพ เลือกผู้มีชีวิตที่ใกล้ที่สุด 0–1 คน<br>ข้ามหัวใจ ไม่ต่อระเบิด ไม่ปลุก Wife<br>ให้ระบบเช็กผู้ชนะหลังตัดสินเหยื่อครบ')}
    ${step('4','ก่อนอภิปราย: เคลียร์คิวค้าง','ปิดโจมตี Final −30 นาที · เคลียร์โจมตีและรักษา<br>ก่อนอภิปราย/Final · Hunt หมดต้องรอหลักฐาน<br>ที่ทันเส้นตาย ไม่ใช้เวลาที่ Host อนุมัติเป็นเวลากำจัด')}
    ${step('5','โหวต: ดูแลช่วงห้ามสื่อสาร','ดูบัตรเพื่อดูแลเกม บันทึกเตือนเมื่อมีคนสื่อสาร<br>ไม่ตัดบัตรหรือเพิ่มเวลาอัตโนมัติจากคำเตือน<br>รอระบบประกาศผล แล้วดูสรุปบทบาทหลังเกม')}
    ${note('ชุดนี้ใช้กับห้องใหม่ v2.4 ฉบับ Wife โหวตซ้ำ','ไม่ใช้กติกา legacy · ไม่มี Sumo<br>อ้างอิง GAME_RULES.md และหน้าคู่มือในเกม')}`},
];

const css = `
*{box-sizing:border-box}body{margin:0;background:#20322e;color:#f3f5e9;font-family:'Google Sans',sans-serif;font-size:32px;line-height:1.52}p,h1,h2,h3{margin:0}b,strong{font-weight:700}p{overflow-wrap:break-word}em{font-style:normal;color:#a3ff72}.page{position:relative;width:1080px;height:1920px;padding:56px 62px 90px;background:radial-gradient(ellipse at 90% 0,#1b3829 0,transparent 50%),#061210;overflow:hidden;margin:24px auto;border-top:12px solid #a3ff72}.page:after{content:'';position:absolute;right:0;top:140px;width:15px;height:180px;background:#ff3347;box-shadow:0 210px #41635f}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}.logo{width:216px;height:78px}.edition{color:#a8bcb7;font-size:23px;letter-spacing:2px}.kicker{color:#a3ff72;font-size:25px;font-weight:bold;letter-spacing:2px;margin-bottom:15px}h1{font-size:65px;line-height:1.24;letter-spacing:-1.7px;margin-bottom:19px}.sub{font-size:29px;color:#a8bcb7;margin-bottom:30px}h3{font-size:35px;line-height:1.4;margin-bottom:9px}.content{display:flex;flex-direction:column;gap:22px}.card{padding:23px 28px;background:#102420;border:2px solid #41635f}.card h3{color:#f3f5e9}.card p,.role p,.step p{color:#c9d7d0}.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}.two h3{font-size:32px}.two p{font-size:29px}.red{border-left:8px solid #ff3347}.green{border-left:8px solid #a3ff72}.amber{border-left:8px solid #ffd45a}.note{padding:23px 27px;background:#1c2b1b;border-left:8px solid #a3ff72}.note b{display:block;color:#a3ff72;font-size:32px;margin-bottom:7px}.note p{font-size:29px;color:#d6dfd2}.footer{position:absolute;bottom:33px;left:62px;right:62px;display:flex;justify-content:space-between;align-items:center;border-top:2px solid #41635f;padding-top:16px;font-size:22px;color:#a8bcb7}.footer strong{color:#a3ff72;font-size:28px;letter-spacing:3px}.portrait{width:172px;height:172px;object-fit:cover;image-rendering:pixelated}.role{display:grid;grid-template-columns:172px 1fr;gap:25px;padding:26px 24px;background:#102420;border:2px solid #41635f}.role-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.hp{color:#ffd45a;font-size:27px;white-space:nowrap}.role p{font-size:30px}.role h3{font-size:37px;color:#a3ff72}.flow{display:flex;justify-content:space-between;align-items:center;color:#ff8792;background:#271c21;padding:18px 26px;font-size:29px}.stats{display:flex;gap:18px}.stat{flex:1;background:#142d24;border-top:5px solid #a3ff72;text-align:center;padding:17px 10px}.stat strong{display:block;font-size:79px;line-height:1.1;color:#a3ff72}.stat span{font-size:28px}.step{display:grid;grid-template-columns:76px 1fr;gap:24px;padding:17px 0}.num{display:flex;justify-content:center;align-items:center;width:70px;height:70px;background:#a3ff72;color:#061210;font-size:35px;font-weight:bold;box-shadow:5px 5px #365c36}.step h3{margin-bottom:5px}.steps .step+.step{border-top:2px solid #29483c}.hero{position:relative;display:flex;height:300px;overflow:hidden;gap:8px;background:#102420}.hero .portrait{width:50%;height:420px;object-fit:cover;object-position:center 29%}.hero-label{position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:space-around;background:#061210df;padding:11px;font-size:24px;letter-spacing:3px}.hero-label span:first-child{color:#ff8792}.hero-label span:last-child{color:#a3ff72}.intro .content{gap:19px}.intro .step{padding:14px 0}.intro .step p{font-size:30px}.mini-roles .portrait{float:left;width:106px;height:106px;margin-right:18px}.mini-roles h3{font-size:30px}.mini-roles .hp{display:block}.mini-roles p{clear:both;padding-top:13px}.small{padding:17px 24px}.small h3{font-size:29px}.small p{font-size:28px}.support .content{gap:17px}.support .role{padding:21px}.support .role p{font-size:29px}.hunt{display:flex;gap:25px;align-items:center;border:2px solid #a3ff72;padding:25px;background:#142d24}.big-time{font-size:90px;line-height:1.1;color:#a3ff72;font-weight:bold;text-align:center}.big-time span{display:block;font-size:29px}.hunt h3{font-size:33px}.hunt p{font-size:28px}.timeline .step{padding:15px 0}.timeline .num{font-size:29px}.timeline .step p{font-size:29px}.gate{display:flex;align-items:center;gap:28px;background:#1e3228;padding:19px 26px;border:2px solid #a3ff72}.gate>b{font-size:37px;color:#a3ff72}.gate span{font-size:30px}.green-text{color:#a3ff72}.red-text{color:#ff8792}.results{display:grid;grid-template-columns:1fr 1fr;gap:16px}.results .amber{grid-column:1/-1}.results h3{font-size:31px}.results p{font-size:29px}.vote .content{gap:16px}.vote .card{padding:19px 25px}.vote .card p{font-size:29px}.vote .note p{font-size:28px}.host-banner{display:flex;align-items:center;gap:24px;background:#102420;border:2px solid #41635f;padding:20px}.host-banner .portrait{width:135px;height:135px}.host-banner h3{font-size:32px}.host-banner p{font-size:27px}.host .content{gap:8px}.host .step{padding:16px 0}.host .step p{font-size:29px}.host .step h3{font-size:33px}.host .note{margin-top:12px}.host .note b{font-size:29px}.host .note p{font-size:27px}
`;
const compact = `body{line-height:1.4}.page{padding-top:44px}.top{margin-bottom:20px}h1{font-size:61px;margin-bottom:15px}.sub{margin-bottom:24px}.content{gap:18px}.card{padding:18px 25px}.role{grid-template-columns:135px 1fr;padding:21px;gap:22px}.role>.portrait{width:135px;height:150px}.stat strong{font-size:69px}.stat{padding:13px 8px}.note{padding:19px 24px}.step{padding:13px 0}.attack-steps .step{padding:13px 0}.timeline .step{padding:8px 0}.host .step{padding:8px 0}.host .content{gap:7px}.role h3{font-size:35px}.support .role p{font-size:30px}.host .step p,.timeline .step p,.vote .card p{font-size:30px}#page-2 .content{gap:14px}#page-2 .flow{padding:10px 24px}.vote .card{padding:15px 25px}.vote .content{gap:13px}`;
const html = `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>KILLER · คู่มือ v2.4</title><style>${fontCss}${css}${compact}</style><body>${pages.map((p,i)=>`<article class="page ${p.cls||''}" id="page-${i+1}"><header class="top">${logo}<span class="edition">FIELD MANUAL / V2.4</span></header><div class="kicker">${p.kicker}</div><h1>${p.title}</h1><p class="sub">${p.sub}</p><main class="content">${p.body}</main><footer class="footer"><span>KILLER · คู่มือห้องใหม่ / Wife โหวตซ้ำ</span><strong>${String(i+1).padStart(2,'0')} / 08</strong></footer></article>`).join('')}</body></html>`;
await fs.writeFile(path.join(out,'manual.html'),html);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:1200,height:2100},deviceScaleFactor:1});
  await page.goto(pathToFileURL(path.join(out,'manual.html')).href);
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode())));
  const checks = await page.locator('.page').evaluateAll(els=>els.map(el=>{
    const content=el.querySelector('.content').getBoundingClientRect(),footer=el.querySelector('.footer').getBoundingClientRect();
    const overflow=[...el.querySelectorAll('*')].filter(n=>n.scrollWidth>n.clientWidth+2 && n.clientWidth>0).map(n=>n.tagName+'.'+n.className);
    return {page:el.id,contentBottom:Math.round(content.bottom-el.getBoundingClientRect().top),footerTop:Math.round(footer.top-el.getBoundingClientRect().top),gap:Math.round(footer.top-content.bottom),overflow};
  }));
  console.log(JSON.stringify(checks,null,2));
  await fs.writeFile(path.join(out,'layout-check.json'),JSON.stringify(checks,null,2));
  if(checks.some(c=>c.gap<15||c.overflow.length))throw new Error('Layout overflow: revise content/styles before export');
  for(let i=0;i<pages.length;i++)await page.locator('#page-'+(i+1)).screenshot({path:path.join(out,`${String(i+1).padStart(2,'0')}-${pages[i].slug}.png`)});
  const sheet = await browser.newPage({viewport:{width:1440,height:1280},deviceScaleFactor:1});
  await sheet.setContent(`<html><body style="margin:0;display:grid;grid-template-columns:repeat(4,360px)">${pages.map(()=>`<img style="display:block;width:360px;height:640px">`).join('')}</body></html>`);
  const pngs=await Promise.all(pages.map((p,i)=>fs.readFile(path.join(out,`${String(i+1).padStart(2,'0')}-${p.slug}.png`))));
  await sheet.evaluate(arr=>Promise.all([...document.images].map((img,i)=>{img.src='data:image/png;base64,'+arr[i];return img.decode();})),pngs.map(b=>b.toString('base64')));
  await sheet.screenshot({path:path.join(out,'overview-360.png')});
} finally {await browser.close();}
