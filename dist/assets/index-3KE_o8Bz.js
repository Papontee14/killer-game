(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))s(o);new MutationObserver(o=>{for(const i of o)if(i.type==="childList")for(const d of i.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&s(d)}).observe(document,{childList:!0,subtree:!0});function t(o){const i={};return o.integrity&&(i.integrity=o.integrity),o.referrerPolicy&&(i.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?i.credentials="include":o.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function s(o){if(o.ep)return;o.ep=!0;const i=t(o);fetch(o.href,i)}})();const m=document.querySelector("#app"),c="killer-mobile-game-v1",a={names:[],game:null,modal:null};function b(){var n;try{const e=JSON.parse(localStorage.getItem(c));(n=e==null?void 0:e.players)!=null&&n.length&&(a.game=e)}catch{localStorage.removeItem(c)}}function f(){a.game&&localStorage.setItem(c,JSON.stringify(a.game))}function g(n){const e=[...n];for(let t=e.length-1;t>0;t--){const s=Math.floor(Math.random()*(t+1));[e[t],e[s]]=[e[s],e[t]]}return e}function h(){const n=[...new Set(a.names.map(t=>t.trim()).filter(Boolean))];if(n.length<3)return;const e=g(n).map((t,s)=>({id:crypto.randomUUID(),name:t,alive:!0,targetId:null,order:s}));e.forEach((t,s)=>{t.targetId=e[(s+1)%e.length].id}),a.game={players:e,startedAt:Date.now(),eliminated:[]},a.names=[],f(),l()}function p(){return a.game.players.filter(n=>n.alive)}function u(n){return a.game.players.find(e=>e.id===n)}function y(n){const e=u(n);if(!e||!e.alive)return;const t=p();if(t.length<=1)return;const s=t.find(o=>o.targetId===e.id);e.alive=!1,s&&(s.targetId=e.targetId),a.game.eliminated.unshift({name:e.name,time:Date.now()}),f(),a.modal=null,l()}function v(){localStorage.removeItem(c),a.game=null,a.modal=null,l()}function $(){const n=a.names.map((e,t)=>`
    <li class="name-chip"><span>${r(e)}</span><button data-action="remove-name" data-index="${t}" aria-label="ลบ ${r(e)}">×</button></li>
  `).join("");return`
    <main class="setup-shell">
      <section class="brand-block">
        <span class="eyebrow">PARTY GAME</span>
        <h1>KILLER</h1>
        <p>ตามล่าเป้าหมายของคุณ<br>และอย่าให้ใครตามคุณทัน</p>
      </section>
      <section class="setup-panel" aria-label="ตั้งค่าเกม">
        <div class="section-heading"><span class="step">01</span><h2>ผู้เล่น</h2><span class="counter">${a.names.length}</span></div>
        <form id="add-player-form" class="add-player">
          <input id="player-name" autocomplete="off" maxlength="24" placeholder="ใส่ชื่อผู้เล่น" aria-label="ชื่อผู้เล่น" />
          <button class="icon-button" type="submit" aria-label="เพิ่มผู้เล่น">+</button>
        </form>
        <ul class="name-list">${n||'<li class="empty-note">เพิ่มผู้เล่นอย่างน้อย 3 คน</li>'}</ul>
        <button class="primary-button" data-action="start" ${a.names.length<3?"disabled":""}>เริ่มเกม <span>→</span></button>
      </section>
      <p class="footer-note">ส่งโทรศัพท์ให้ผู้เล่นทีละคนเพื่อดูเป้าหมายลับ</p>
    </main>`}function I(){const n=p(),e=n.length===1?n[0]:null,t=a.game.players.map(s=>`
    <li class="player-row ${s.alive?"":"is-out"}">
      <span class="player-mark">${s.alive?"●":"×"}</span>
      <span class="player-name">${r(s.name)}</span>
      <span class="player-state">${s.alive?"ยังอยู่":"ออกแล้ว"}</span>
    </li>`).join("");return`
    <main class="game-shell">
      <header class="topbar">
        <div><span class="eyebrow">KILLER GAME</span><h1>เกมกำลังดำเนินอยู่</h1></div>
        <button class="more-button" data-action="confirm-reset" aria-label="เมนูเกม">•••</button>
      </header>
      ${e?`<section class="winner"><span>ผู้รอดชีวิต</span><strong>${r(e.name)}</strong><button data-action="confirm-reset">เริ่มเกมใหม่</button></section>`:`
      <section class="status-card"><span>ผู้เล่นที่ยังอยู่</span><strong>${n.length}</strong><small>จาก ${a.game.players.length} คน</small></section>
      <section class="mission-card">
        <div class="target-icon">◎</div><div><span>ภารกิจลับ</span><h2>ดูเป้าหมายของคุณ</h2><p>ส่งโทรศัพท์ให้ผู้เล่น และอย่าให้คนอื่นเห็น</p></div>
        <button class="primary-button compact" data-action="choose-mission">เปิดภารกิจ <span>→</span></button>
      </section>`}
      <section class="roster"><div class="section-heading"><span class="step">LIVE</span><h2>สถานะผู้เล่น</h2></div><ul>${t}</ul></section>
      ${e?"":'<button class="eliminate-button" data-action="choose-eliminate">บันทึกผู้เล่นที่ถูกกำจัด</button>'}
    </main>`}function w(){if(!a.modal)return"";const n=p();if(a.modal.type==="mission")return`<div class="modal-backdrop"><section class="modal"><button class="close" data-action="close-modal" aria-label="ปิด">×</button><span class="eyebrow">PRIVATE MISSION</span><h2>เลือกชื่อของคุณ</h2><select id="mission-player">${n.map(t=>`<option value="${t.id}">${r(t.name)}</option>`).join("")}</select><button class="primary-button" data-action="reveal-target">เปิดเป้าหมาย <span>→</span></button></section></div>`;if(a.modal.type==="target"){const e=u(a.modal.targetId);return`<div class="modal-backdrop"><section class="modal target-modal"><button class="close" data-action="close-modal" aria-label="ปิด">×</button><span class="eyebrow">YOUR TARGET</span><p>เป้าหมายของคุณคือ</p><h2>${r((e==null?void 0:e.name)||"-")}</h2><div class="target-circle">◎</div><small>เก็บชื่อนี้ไว้เป็นความลับ</small><button class="primary-button" data-action="close-modal">จำได้แล้ว</button></section></div>`}return a.modal.type==="eliminate"?`<div class="modal-backdrop"><section class="modal"><button class="close" data-action="close-modal" aria-label="ปิด">×</button><span class="eyebrow">GAME MASTER</span><h2>ใครถูกกำจัด?</h2><div class="choices">${n.map(t=>`<button class="choice-row" data-action="eliminate" data-id="${t.id}"><span>${r(t.name)}</span><span>→</span></button>`).join("")}</div></section></div>`:'<div class="modal-backdrop"><section class="modal"><button class="close" data-action="close-modal" aria-label="ปิด">×</button><span class="eyebrow">RESET GAME</span><h2>เริ่มเกมใหม่?</h2><p>ผลการแข่งขันและรายชื่อในเกมนี้จะถูกล้าง</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">ยกเลิก</button><button class="danger-button" data-action="reset">เริ่มใหม่</button></div></section></div>'}function r(n){return String(n).replace(/[&<>'"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"})[e])}function l(){m.innerHTML=(a.game?I():$())+w()}m.addEventListener("submit",n=>{if(n.target.id!=="add-player-form")return;n.preventDefault();const t=document.querySelector("#player-name").value.trim();t&&!a.names.some(s=>s.toLowerCase()===t.toLowerCase())&&a.names.push(t),l()});m.addEventListener("click",n=>{const e=n.target.closest("[data-action]");if(!e)return;const{action:t,index:s,id:o}=e.dataset;if(t==="remove-name"&&(a.names.splice(Number(s),1),l()),t==="start"&&h(),t==="close-modal"&&(a.modal=null,l()),t==="choose-mission"&&(a.modal={type:"mission"},l()),t==="reveal-target"){const i=u(document.querySelector("#mission-player").value);a.modal={type:"target",targetId:i.targetId},l()}t==="choose-eliminate"&&(a.modal={type:"eliminate"},l()),t==="eliminate"&&y(o),t==="confirm-reset"&&(a.modal={type:"reset"},l()),t==="reset"&&v()});b();l();
