import { test, expect } from "@playwright/test";
import { database, fixture } from "../db-harness.mjs";
let db,
  f,
  transportQueue = Promise.resolve();
test.beforeAll(async () => {
  db = await database();
});
test.afterAll(async () => {
  await db?.close();
});
test.beforeEach(async () => {
  f = await fixture(db);
});

async function openPlayer(page, role, displayName = role, reclaimToken = "") {
  // Browser uses real SQL projections; only the Supabase transport is intercepted.
  await page.route("http://127.0.0.1:54329/**", (route) => {
    const work = async () => {
      const req = route.request(),
        url = new URL(req.url());
      let data = {};
      try {
        if (url.pathname.startsWith("/auth/")) {
          const user = {
            id: f.users[role],
            aud: "authenticated",
            role: "authenticated",
            is_anonymous: true,
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          };
          const payload = Buffer.from(
            JSON.stringify({
              sub: user.id,
              exp: Math.floor(Date.now() / 1000) + 3600,
            }),
          ).toString("base64url");
          data = {
            access_token: `e30.${payload}.test`,
            refresh_token: "test-refresh",
            token_type: "bearer",
            expires_in: 3600,
            user,
          };
        } else if (url.pathname.includes("/rest/v1/rpc/")) {
          const fn = url.pathname.split("/").pop(),
            body = req.postDataJSON() ?? {};
          const orders = {
            get_room_view: ["p_code"],
            resolve_bomb: ["p_code", "p_target_ids"],
            end_game: ["p_code"],
            close_room: ["p_code"],
            set_accusation_at: ["p_code", "p_at"],
            join_room: ["p_code", "p_name", "p_reclaim_token"],
            heartbeat: ["p_code"],
            use_reporter: ["p_code", "p_target_id"],
            submit_evidence: [
              "p_code",
              "p_target_id",
              "p_storage_path",
              "p_captured_at",
            ],
            resolve_police_check: ["p_code", "p_target_id"],
            approve_evidence: ["p_code", "p_evidence_id"],
          };
          data = await f.as(
            role,
            fn,
            orders[fn].map((key) => body[key] ?? null),
          );
        } else if (url.pathname.startsWith("/storage/v1/object/sign/")) {
          data = { signedURL: "/object/public/test-fixture.png" };
        } else if (
          url.pathname === "/storage/v1/object/public/test-fixture.png"
        ) {
          await route.fulfill({
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT8sAAAAASUVORK5CYII=",
              "base64",
            ),
          });
          return;
        } else if (url.pathname.startsWith("/storage/v1/object/evidence/")) {
          const path = decodeURIComponent(url.pathname.split("/evidence/")[1]);
          await db.query(
            'insert into storage.objects(bucket_id,name,metadata) values(\'evidence\',$1,\'{"mimetype":"image/jpeg","size":100}\')',
            [path],
          );
          data = { Key: "evidence/" + path };
        }
        await route.fulfill({ json: data });
      } catch (e) {
        await route.fulfill({ status: 400, json: { message: e.message } });
      }
    };
    transportQueue = transportQueue.then(work);
    return transportQueue;
  });
  if (role === "host") {
    await page.goto("/room/ABCDEF/host");
    await expect(page.getByText("ภาพรวมภารกิจ")).toBeVisible();
    return;
  }
  await page.goto("/");
  await page.getByLabel("รหัสห้อง").fill("ABCDEF");
  await page.getByLabel("ชื่อผู้เล่น").fill(displayName);
  if (reclaimToken) {
    await page
      .getByRole("button", { name: "เคยเข้าร่วมแล้ว? กู้คืนตัวละคร" })
      .click();
    await page.getByLabel("รหัสกู้คืน", { exact: true }).fill(reclaimToken);
  }
  await page
    .getByRole("button", {
      name: reclaimToken ? "กู้คืนตัวละคร" : "เข้าสู่เกม",
      exact: true,
    })
    .click();
  await expect(page.getByRole("button", { name: "เข้าใจแล้ว" })).toBeVisible();
  await page.getByRole("button", { name: "เข้าใจแล้ว" }).click();
  await expect(page.locator(".player-hero")).toBeVisible();
}

test("Killer sees ally and shared progress without ally target or file upload; camera captures and stops", async ({
  page,
}) => {
  await f.hit("killer-wife");
  await f.hit("killer-wife");
  await openPlayer(page, "killer");
  await expect(page.getByText("คู่ Killer: killer-wife")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "หลักฐานร่วมของทีม" }),
  ).toBeVisible();
  await expect(
    page.locator('select option[value="' + f.players["killer-wife"] + '"]'),
  ).toHaveCount(0);
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await page.locator("select").selectOption(f.players.sumo);
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ถ่ายรูป", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.testTracks = document.querySelector("video").srcObject.getTracks();
  });
  await page.getByRole("button", { name: "ถ่ายรูป", exact: true }).click();
  await expect(page.getByAltText("ตัวอย่างหลักฐานก่อนส่ง")).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.testTracks.every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "ส่งหลักฐานให้ Host" }).click();
  await expect(page.getByText("รอ Host ตรวจ", { exact: true })).toBeVisible();
});

test("full quota still allows camera; permission denial offers retry without file fallback", async ({
  page,
}) => {
  await f.hit("sumo");
  await f.hit("athlete");
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("denied", "NotAllowedError");
    };
  });
  await openPlayer(page, "killer");
  await page.locator("select").selectOption(f.players.sumo);
  await expect(
    page.getByRole("button", { name: "เปิดกล้อง", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await expect(page.locator(".live-camera [role=alert]")).toContainText(
    "อนุญาตให้ใช้กล้อง",
  );
  await expect(
    page.getByRole("button", { name: "เปิดกล้อง", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("input[type=file]")).toHaveCount(0);
});

test("Reporter cannot select dead/self; target dies after selection: no ability spent", async ({
  page,
}) => {
  await db.query("update public.players set health='dead' where id=$1", [
    f.players.villager,
  ]);
  await openPlayer(page, "reporter");
  for (const role of ["villager", "reporter"])
    await expect(
      page.locator(`select option[value="${f.players[role]}"]`),
    ).toHaveCount(0);
  await page.locator("select").selectOption(f.players.sumo);
  await db.query("update public.players set health='dead' where id=$1", [
    f.players.sumo,
  ]);
  await page
    .getByRole("button", { name: "ใช้ความสามารถ", exact: true })
    .click();
  await page.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  await expect(
    page.getByText(
      "ใช้ความสามารถไม่ได้ เป้าหมายหรือสถานะเกมอาจเปลี่ยนแล้ว กรุณาตรวจสอบและลองใหม่",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await f.state("reporter")).has_used_ability).toBe(false);
});

test("police accusation renders and resolves city victory", async ({
  page,
}) => {
  await db.exec("update public.rooms set phase='police-check'");
  await openPlayer(page, "police");
  await page.locator("select").selectOption(f.players.killer);
  await page.getByRole("button", { name: "ยืนยันการชี้ตัว" }).click();
  await page.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  await expect(
    page.getByText("ฝ่ายเมืองชนะ", { exact: true }).first(),
  ).toBeVisible();
});

test("Host can review evidence and both Killer sessions receive the same result", async ({
  browser,
}) => {
  await f.hit("killer-wife");
  await f.hit("killer-wife");
  await f.resetQuota();
  await f.evidence("sumo");
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ serviceWorkers: "block" })),
  );
  try {
    const pages = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    for (const [index, role] of ["host", "killer", "killer-wife"].entries())
      await openPlayer(pages[index], role);
    await expect(
      pages[0].getByText("เฉพาะ Host · บทบาทและหัวใจ"),
    ).toBeVisible();
    await expect(pages[0].getByAltText("หลักฐานการโจมตี")).toBeVisible();
    await expect
      .poll(() =>
        pages[0]
          .getByAltText("หลักฐานการโจมตี")
          .evaluate((img) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await pages[0]
      .getByRole("button", { name: "อนุมัติ", exact: true })
      .click();
    await expect(pages[0].getByText("ยังไม่มีหลักฐานรอตรวจ")).toBeVisible();
    // Polling is the transport fallback in this suite; Realtime service is not mocked as a success.
    for (const page of pages.slice(1))
      await expect(
        page.getByText("อนุมัติแล้ว · เป้าหมายยังมีชีวิต", { exact: true }),
      ).toHaveCount(3, { timeout: 20000 });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("captured image older than two minutes cannot be submitted; closing camera stops tracks", async ({
  page,
}) => {
  await openPlayer(page, "killer");
  await page.locator("select").selectOption(f.players.sumo);
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ถ่ายรูป", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.testTracks = document.querySelector("video").srcObject.getTracks();
  });
  await page.getByRole("button", { name: "ปิดกล้อง", exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.testTracks.every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ถ่ายรูป", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "ถ่ายรูป", exact: true }).click();
  await expect(page.getByAltText("ตัวอย่างหลักฐานก่อนส่ง")).toBeVisible();
  await page.evaluate(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + 121000;
  });
  await expect(
    page.getByRole("button", { name: "ส่งหลักฐานให้ Host" }),
  ).toBeDisabled();
  await expect(
    page.getByText("รูปเกิน 2 นาทีแล้ว กรุณาถ่ายใหม่", { exact: true }),
  ).toBeVisible();
  expect(
    (await db.query("select count(*)::int n from public.evidence")).rows[0].n,
  ).toBe(0);
});

test("player auto-resumes room on cold relaunch and can leave via name confirmation", async ({
  page,
}) => {
  await openPlayer(page, "killer");
  await expect(page.locator(".player-hero")).toBeVisible();

  // Simulate cold app relaunch by navigating to root "/"
  await page.goto("/");

  // Should automatically redirect back to the room and restore player screen
  await expect(page).toHaveURL(/\/room\/ABCDEF/);
  await expect(page.locator(".player-hero")).toBeVisible();

  await page.getByRole("button", { name: "เข้าใจแล้ว" }).click();
  // Try to leave: click the leave button in topbar
  await page.locator(".topbar button.back-link").click();
  await expect(page.getByRole("heading", { name: "ออกจากเกม" })).toBeVisible();

  // Cancelling keeps player in the room
  await page.getByRole("button", { name: "ยกเลิก" }).click();
  await expect(
    page.getByRole("heading", { name: "ออกจากเกม" }),
  ).not.toBeVisible();
  await expect(page.locator(".player-hero")).toBeVisible();

  // Reopen modal and type wrong name
  await page.locator(".topbar button.back-link").click();
  await page.getByPlaceholder("killer").fill("wrong-name");
  await page.getByRole("button", { name: "ยืนยันออก" }).click();
  await expect(
    page.getByText("ชื่อไม่ตรงกับชื่อในเกม กรุณาลองใหม่"),
  ).toBeVisible();

  // Type correct name and confirm leave
  await page.getByPlaceholder("killer").fill("killer");
  await page.getByRole("button", { name: "ยืนยันออก" }).click();

  // Should navigate back to root and NOT auto-resume
  await expect(page).toHaveURL("/");
  await expect(page.getByText("เข้าห้องของเพื่อน")).toBeVisible();

  // Reloading "/" stays on landing page because active session was cleared
  await page.goto("/");
  await expect(page.getByText("เข้าห้องของเพื่อน")).toBeVisible();
});

test("all nine role variants keep public roster private at 360px", async ({
  browser,
}) => {
  for (const role of [
    "killer",
    "killer-wife",
    "police",
    "reporter",
    "bomber",
    "detective",
    "athlete",
    "sumo",
    "villager",
  ]) {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      await openPlayer(page, role);
      const health = page.locator(".personal-health .hearts svg");
      await expect(health).toHaveCount(
        role === "killer"
          ? 0
          : role === "athlete"
            ? 3
            : role === "sumo"
              ? 4
              : 2,
      );
      await page
        .getByRole("navigation", { name: "เมนูผู้เล่น" })
        .getByRole("button", { name: "ผู้เล่น", exact: true })
        .click();
      await expect(page.locator(".tab-content .player-card")).toHaveCount(9);
      await expect(page.locator(".tab-content .hearts")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "ข่าวสาร", exact: true }).click();
      await expect(page.locator(".tab-content h1")).toHaveText("ข่าวสาร");
      await page
        .getByRole("button", { name: "เพิ่มเติม", exact: true })
        .click();
      await page.getByRole("button", { name: "กติกาและวิธีเล่น" }).click();
      await expect(page.getByRole("dialog").locator("details")).toHaveCount(9);
    } finally {
      await context.close();
    }
  }
});

test("live private role transitions show new actions without leaking identity", async ({
  page,
}) => {
  await openPlayer(page, "killer-wife");
  await f.hit("killer-wife");
  await f.hit("killer-wife");
  await expect(
    page.getByRole("heading", { name: "บทบาทของคุณเปลี่ยนแล้ว" }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "เข้าใจแล้ว" }).click();
  await expect(page.locator(".personal-health")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "เปิดกล้อง", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".quota-panel")).toContainText("2 / 3");
  await page.getByRole("button", { name: "ผู้เล่น", exact: true }).click();
  await expect(
    page
      .locator(".tab-content .player-card")
      .filter({ hasText: "killer-wife" }),
  ).toContainText("มีชีวิต");
});

test("Host can resolve zero-person bomb and download archive before closing", async ({
  page,
}) => {
  await f.hit("bomber");
  await f.hit("bomber");
  await openPlayer(page, "host");
  await page.getByRole("button", { name: "ดำเนินการระเบิด" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "ไม่เลือกผู้ได้รับผลระเบิด",
  );
  await page.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  await expect(page.locator(".phase-badge")).toHaveText("กำลังเล่น");
  await page.getByRole("button", { name: "จบเกม", exact: true }).click();
  await page.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  await expect(page.locator(".game-ended-notice")).toContainText(
    "Host ได้ทำการจบเกม",
  );
  await page.getByRole("button", { name: "ดาวน์โหลดข้อมูลและปิดห้อง" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "รูปหลักฐานในห้องจะถูกลบ",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  expect((await download).suggestedFilename()).toContain("killer-ABCDEF");
  await expect(page).toHaveURL("/");
});

test("responsive Thai entry and Host navigation produce review screenshots", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "เข้าห้องของเพื่อน" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/redesign-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/redesign-mobile.png",
    fullPage: true,
  });
  const names = [
    "นนท์",
    "มิน",
    "ภัทร",
    "พลอย",
    "ต้น",
    "ฟ้า",
    "วิน",
    "บอส",
    "แพรว",
  ];
  for (const [i, id] of Object.values(f.players).entries())
    await db.query("update public.players set name=$2 where id=$1", [
      id,
      names[i],
    ]);
  await db.exec("update public.rooms set host_name='พี่อาร์ต'");
  await openPlayer(page, "host");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/redesign-host.png",
    fullPage: true,
  });
  const nav = page.getByRole("navigation", { name: "เมนู Host" });
  await nav.getByRole("button", { name: "ตั้งค่าห้อง" }).click();
  await expect(page.getByLabel("วันและเวลาตำรวจชี้ตัว")).toBeVisible();
  await nav.getByRole("button", { name: "ตรวจหลักฐาน" }).click();
  await expect(page.getByText("ยังไม่มีหลักฐานรอตรวจ")).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("new-device recovery restores the same character, not an extra player", async ({
  page,
}) => {
  const token = "abcdef0123456789abcdef0123456789";
  await db.query(
    "update public.player_secrets set hearts=3 where player_id=$1",
    [f.players.sumo],
  );
  await db.query(
    "update public.players set reclaim_token_hash=md5($2) where id=$1",
    [f.players.sumo, token],
  );
  await openPlayer(page, "outsider", "sumo", token);
  await expect(page.locator(".personal-health h2")).toContainText("3");
  await expect(page.locator(".player-hero h1")).toHaveText("ซูโม่");
  expect(
    (await db.query("select count(*)::int n from public.players")).rows[0].n,
  ).toBe(9);
});

test("moving away from the camera stops the stream and does not reopen it", async ({
  page,
}) => {
  await openPlayer(page, "killer");
  await page.locator("select").selectOption(f.players.sumo);
  await page.getByRole("button", { name: "เปิดกล้อง", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ถ่ายรูป", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.testTracks = document.querySelector("video").srcObject.getTracks();
  });
  await page.getByRole("button", { name: "ผู้เล่น", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.testTracks.every((t) => t.readyState === "ended"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "หน้าหลัก", exact: true }).click();
  await expect(page.locator("video")).toHaveCount(0);
});

test("Detective privately receives Police role after Police death", async ({
  page,
}) => {
  await openPlayer(page, "detective");
  await f.hit("police");
  await f.hit("police");
  await expect(
    page.getByRole("heading", { name: "บทบาทของคุณเปลี่ยนแล้ว" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("dialog")).toContainText("นักสืบ → ตำรวจ");
  await page.getByRole("button", { name: "เข้าใจแล้ว" }).click();
  await expect(page.locator(".player-hero h1")).toHaveText("ตำรวจ");
});

test("existing player sees room closure after Host closes lobby", async ({
  page,
}) => {
  await openPlayer(page, "villager");
  await db.exec("update public.rooms set phase='lobby'");
  await f.as("host", "close_room", ["ABCDEF"]);
  await expect(
    page.getByRole("heading", { name: "ห้องถูกปิดแล้ว" }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("link", { name: "กลับหน้าแรก" }).click();
  await expect(
    page.getByRole("heading", { name: "เข้าห้องของเพื่อน" }),
  ).toBeVisible();
});

test("failed close remains retryable after archive is downloaded", async ({
  page,
}) => {
  await openPlayer(page, "host");
  await page.getByRole("button", { name: "จบเกม", exact: true }).click();
  await page.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  await expect(page.locator(".game-ended-notice")).toBeVisible();
  let attempts = 0,
    downloads = 0;
  page.on("download", () => downloads++);
  await page.route("**/rest/v1/rpc/close_room", async (route) => {
    if (attempts++ === 0)
      await route.fulfill({
        status: 503,
        json: { message: "temporary failure" },
      });
    else await route.fallback();
  });
  await page.getByRole("button", { name: "ดาวน์โหลดข้อมูลและปิดห้อง" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  await downloaded;
  await expect(page.locator(".error-banner")).toContainText("กรุณาลองใหม่");
  await page.getByRole("button", { name: "ดาวน์โหลดข้อมูลและปิดห้อง" }).click();
  await page.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  await expect(page).toHaveURL("/");
  expect(downloads).toBe(1);
});
