import { test, expect } from "@playwright/test";
import { database, fixture } from "../db-harness.mjs";
let db,
  f,
  transportQueue = Promise.resolve();
const CAMERA_PNG = {
  name: "camera.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT8sAAAAASUVORK5CYII=",
    "base64",
  ),
};
test.beforeAll(async () => {
  db = await database();
});
test.afterAll(async () => {
  await db?.close();
});
test.beforeEach(async () => {
  f = await fixture(db);
});

async function openPlayer(
  page,
  role,
  displayName = role,
  reclaimToken = "",
  reducedMotion = true,
  reveal = true,
) {
  await page.emulateMedia({
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
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
    await expect(page.locator(".host-layout")).toBeVisible();
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
  const playerScreen = page.locator(".player-hero, .lobby-waiting-screen");
  await expect(playerScreen).toBeVisible();
  if (await page.locator(".lobby-waiting-screen").isVisible()) return;
  if (!reveal) return;
  await expect(
    page.getByRole("button", { name: "แตะเพื่อเปิดบทบาท" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "แตะเพื่อเปิดบทบาท" }).click();
  await expect(page.getByRole("button", { name: "เข้าใจแล้ว" })).toBeVisible();
  await page.getByRole("button", { name: "เข้าใจแล้ว" }).click();
  await expect(page.locator(".player-hero")).toBeVisible();
}

test("first role reveal keeps the role secret until its card finishes turning", async ({
  page,
}) => {
  await openPlayer(page, "villager", "villager", "", false, false);
  const dialog = page.getByRole("dialog");
  const card = dialog.getByRole("button", { name: "แตะเพื่อเปิดบทบาท" });
  await expect(card).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Villager" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "เข้าใจแล้ว" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await card.click();
  const spinningCard = dialog.locator(".role-reveal-card");
  await expect(dialog.locator(".role-card-trigger")).toBeDisabled();
  await expect(spinningCard).toHaveCSS("animation-name", "role-card-reveal");
  await expect(dialog.getByRole("button", { name: "เข้าใจแล้ว" })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Villager" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "เข้าใจแล้ว" })).toBeVisible();
  await spinningCard.hover();
  await expect(spinningCard).toHaveCSS("filter", "none");
});

test("completed role reveal stays revealed after reload before acknowledgement and resets for a new game", async ({ page }) => {
  await openPlayer(page, "villager", "villager", "", true, false);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "แตะเพื่อเปิดบทบาท" }).click();
  await expect(dialog.getByRole("button", { name: "เข้าใจแล้ว" })).toBeVisible();
  // Completion is saved even before the player presses the acknowledgement.
  await page.reload();
  await expect(dialog.getByRole("heading", { name: "Villager", exact: true })).toBeVisible();
  await expect(dialog.locator(".role-card-trigger")).toHaveCount(0);
  await dialog.getByRole("button", { name: "เข้าใจแล้ว" }).click();
  await page.getByRole("button", { name: "อ่านบทบาทของฉัน" }).click();
  await expect(dialog.locator(".role-card-trigger")).toHaveCount(0);
  // A distinct room creation cannot inherit the flag, even with the same code.
  await db.exec("update public.rooms set created_at=created_at + interval '1 second'");
  await page.reload();
  await expect(dialog.getByRole("button", { name: "แตะเพื่อเปิดบทบาท" })).toBeVisible();
});

for (const [width, height, key] of [[360, 640, "Enter"], [1280, 900, "Space"]]) {
  test(`ornate role card reveals with ${key} and stays stable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await openPlayer(page, "killer", "killer", "", false, false);
    const dialog = page.getByRole("dialog");
    const trigger = dialog.locator(".role-card-trigger");
    await expect(trigger).toBeEnabled();
    await expect(dialog.locator(".role-card-identity")).toBeHidden();
    await expect(dialog.locator(".role-reveal")).not.toHaveClass(/killer/);
    const bounds = await dialog.locator(".role-reveal-card-scene").boundingBox();
    expect(bounds.width).toBeLessThanOrEqual(280);
    expect(bounds.width / bounds.height).toBeCloseTo(3 / 4);
    await page.screenshot({ path: testInfo.outputPath("card-waiting.png") });
    await page.mouse.click(2, 2);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await trigger.focus();
    await page.keyboard.press(key);
    await expect(trigger).toBeDisabled();
    // Inspect the middle and final edge-on frame without timing-dependent sleeps.
    await dialog.locator(".role-reveal-card").evaluate((card) => {
      for (const animation of card.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = 1200;
      }
    });
    await expect(dialog.locator(".role-card-identity")).toBeHidden();
    await expect(dialog.locator(".role-card-secret-cover")).toBeVisible();
    await trigger.dispatchEvent("click");
    await expect(dialog.locator(".role-reveal-spinning")).toBeVisible();
    await dialog.locator(".role-reveal-card").evaluate((card) => {
      for (const animation of card.getAnimations({ subtree: true })) animation.finish();
    });
    await expect(dialog.getByRole("heading", { name: "Killer", exact: true })).toBeVisible();
    const rotor = dialog.locator(".role-reveal-card");
    const transform = await rotor.evaluate((node) => getComputedStyle(node).transform);
    await rotor.hover();
    await expect(rotor).toHaveCSS("transform", transform);
    await expect(rotor).toHaveCSS("filter", "none");
    await page.screenshot({ path: testInfo.outputPath("card-revealed.png") });
    await dialog.getByRole("button", { name: "เข้าใจแล้ว" }).click();
    await page.getByRole("button", { name: "อ่านบทบาทของฉัน" }).click();
    await expect(dialog.locator(".role-card-trigger")).toHaveCount(0);
    await expect(dialog.getByRole("heading", { name: "Killer", exact: true })).toBeVisible();
  });
}

test("role card waits for its displayed image and supports retry and reduced motion", async ({ page }) => {
  let releaseImage;
  const imageGate = new Promise((resolve) => { releaseImage = resolve; });
  let failImage = true;
  await page.route("**/_next/image?**", async (route) => {
    await imageGate;
    if (failImage) await route.abort();
    else await route.continue();
  });
  await openPlayer(page, "villager", "villager", "", true, false);
  const dialog = page.getByRole("dialog");
  const trigger = dialog.locator(".role-card-trigger");
  await expect(dialog.getByRole("status")).toHaveText("กำลังเตรียมภาพบทบาท…");
  await expect(trigger).toBeDisabled();
  await expect(dialog.locator(".role-reveal-card")).toHaveCSS("animation-name", "none");
  releaseImage();
  const retry = dialog.getByRole("button", { name: "ลองโหลดภาพอีกครั้ง" });
  await expect(retry).toBeVisible();
  await expect(trigger).toBeDisabled();
  failImage = false;
  await retry.click();
  await expect(trigger).toBeEnabled();
  expect(await dialog.locator(".role-reveal-art").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await trigger.press("Enter");
  await expect(dialog.getByRole("button", { name: "เข้าใจแล้ว" })).toBeVisible();
});

test("player lobby waiting screen fits a small phone without page scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await db.exec("delete from public.player_secrets; update public.rooms set phase='lobby'");
  await openPlayer(page, "outsider", "mobile-lobby-player");
  const waitingScreen = page.locator(".lobby-waiting-screen");
  await expect(waitingScreen).toBeVisible();
  expect(
    await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageWidth: document.scrollingElement?.scrollWidth,
      pageHeight: document.scrollingElement?.scrollHeight,
    })),
  ).toEqual({
    viewportWidth: 360,
    viewportHeight: 640,
    pageWidth: 360,
    pageHeight: 640,
  });
  await expect(page.locator(".waiting-roster")).toHaveCSS("overflow-y", "auto");
});

test("Killer opens the device camera, converts its photo, and sends it to Host", async ({
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
  await page.locator("select").selectOption(f.players.sumo);
  const cameraInput = page.getByLabel("ถ่ายรูปจากกล้องมือถือ");
  await expect(cameraInput).toHaveAttribute("accept", "image/*");
  await expect(cameraInput).toHaveAttribute("capture", "environment");
  await page.getByRole("button", { name: "เปิดกล้องมือถือ", exact: true }).click();
  await cameraInput.setInputFiles(CAMERA_PNG);
  await expect(
    page.getByAltText("ตัวอย่างหลักฐานก่อนส่ง"),
  ).toBeVisible();
  await page.getByRole("button", { name: "ส่งหลักฐานให้ Host" }).click();
  await expect(page.getByText("รอ Host ตรวจ", { exact: true })).toBeVisible();
});

test("full quota blocks the device camera and submission until reset", async ({
  page,
}) => {
  await f.hit("sumo");
  await f.hit("athlete");
  await openPlayer(page, "killer");
  await expect(page.getByRole("button", { name: "เปิดกล้องมือถือ", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "ส่งหลักฐานให้ Host" })).toBeDisabled();
  await expect(page.locator(".quota-cooldown-notice")).toContainText("ไม่สามารถถ่ายหรือส่งรูปได้");
  await db.exec("update public.rooms set quota_window_start=quota_window_start-interval '1 hour'");
  await expect(page.locator("select")).toBeEnabled({ timeout: 20000 });
  await page.locator("select").selectOption(f.players.sumo);
  await expect(
    page.getByRole("button", { name: "เปิดกล้องมือถือ", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("ถ่ายรูปจากกล้องมือถือ")).toHaveAttribute(
    "capture",
    "environment",
  );
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

test("captured image older than two minutes cannot be submitted", async ({
  page,
}) => {
  await openPlayer(page, "killer");
  await page.locator("select").selectOption(f.players.sumo);
  await page.getByRole("button", { name: "เปิดกล้องมือถือ", exact: true }).click();
  await page.getByLabel("ถ่ายรูปจากกล้องมือถือ").setInputFiles(CAMERA_PNG);
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

  await expect(page.locator(".role-card-trigger")).toHaveCount(0);
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
      const roleArt = {
        killer: "/roles/killer.png",
        "killer-wife": "/roles/killer-wife.png",
        police: "/roles/police.png",
        reporter: "/roles/reporter.png",
        bomber: "/roles/bomber.png",
        detective: "/roles/detective.png",
        athlete: "/roles/athlete-male.png",
        sumo: "/roles/sumo-male.png",
        villager: "/roles/villager-1-male.png",
      };
      await expect(page.locator(".player-hero-art")).toHaveAttribute(
        "src",
        roleArt[role],
      );
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
      await expect(page.locator(".tab-content .role-thumb")).toHaveCount(0);
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
      await expect(page.getByRole("dialog").locator(".role-carousel-slide")).toHaveCount(9);
      await expect(page.getByRole("dialog").locator(".role-carousel-art")).toHaveCount(9);
      await expect(page.getByRole("dialog").locator(".role-carousel-position")).toHaveText("1 / 9");
      await page.getByRole("dialog").getByRole("button", { name: "บทบาทถัดไป" }).click();
      await expect(page.getByRole("dialog").locator(".role-carousel-position")).toHaveText("2 / 9");
      await expect(page.getByRole("dialog").locator('[data-role-slide="1"] h4')).toHaveText("Killer's Wife");
      await page.getByRole("dialog").getByRole("button", { name: "บทบาทก่อนหน้า" }).click();
      await expect(page.getByRole("dialog").locator(".role-carousel-position")).toHaveText("1 / 9");
    } finally {
      await context.close();
    }
  }
});

test("Host role setup shows artwork without adding private data to the room", async ({
  page,
}) => {
  await db.exec("update public.rooms set phase='lobby'");
  await openPlayer(page, "host");
  await expect(page.locator(".role-control")).toHaveCount(9);
  await expect(page.locator(".role-control .role-thumb-control")).toHaveCount(9);
});

test("active Killer with a legacy wife role displays Killer", async ({ page }) => {
  await f.hit("killer-wife");
  await f.hit("killer-wife");
  await db.query("update public.player_secrets set role_current='killer-wife' where player_id=$1", [f.players["killer-wife"]]);
  await openPlayer(page, "killer-wife");
  await expect(page.locator(".player-hero h1")).toHaveText("Killer");
  await page.getByRole("button", { name: "อ่านบทบาทของฉัน" }).click();
  await expect(page.getByRole("dialog")).toContainText("Killer");
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
  await expect(page.locator(".player-hero h1")).toHaveText("Killer");
  await expect(page.locator(".personal-health")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "เปิดกล้องมือถือ", exact: true }),
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
    "จบเกมโดยไม่มีผู้ชนะ",
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

test("Host can close an ended room without downloading evidence images", async ({
  page,
}) => {
  await openPlayer(page, "host");
  await page.getByRole("button", { name: "จบเกม", exact: true }).click();
  await page.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  await expect(page.locator(".game-ended-notice")).toBeVisible();
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByRole("button", { name: "ดาวน์โหลดข้อมูลและปิดห้อง" }).click();
  await page
    .getByRole("button", { name: "ปิดห้องโดยไม่ดาวน์โหลดรูป" })
    .click();
  await expect(page).toHaveURL("/");
  expect(downloads).toBe(0);
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
  await expect(page.locator(".player-hero h1")).toHaveText("Sumo");
  expect(
    (await db.query("select count(*)::int n from public.players")).rows[0].n,
  ).toBe(9);
});

test("a photo returned after the target changes is discarded", async ({
  page,
}) => {
  await openPlayer(page, "killer");
  await page.locator("select").selectOption(f.players.sumo);
  await page.getByRole("button", { name: "เปิดกล้องมือถือ", exact: true }).click();
  await page.locator("select").selectOption(f.players.athlete);
  await page.getByLabel("ถ่ายรูปจากกล้องมือถือ").setInputFiles(CAMERA_PNG);
  await expect(page.getByAltText("ตัวอย่างหลักฐานก่อนส่ง")).toHaveCount(0);
  await expect(page.getByText("เป้าหมายเปลี่ยนแล้ว กรุณาถ่ายรูปใหม่")).toBeVisible();
});

test("an unreadable camera photo is rejected before preview", async ({ page }) => {
  await openPlayer(page, "killer");
  await page.locator("select").selectOption(f.players.sumo);
  await page.getByRole("button", { name: "เปิดกล้องมือถือ", exact: true }).click();
  await page.getByLabel("ถ่ายรูปจากกล้องมือถือ").setInputFiles({
    name: "broken.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByAltText("ตัวอย่างหลักฐานก่อนส่ง")).toHaveCount(0);
  await expect(page.getByText("ไม่สามารถอ่านไฟล์รูปภาพนี้ได้")).toBeVisible();
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
  await expect(page.getByRole("dialog")).toContainText("Detective → Police");
  await page.getByRole("button", { name: "เข้าใจแล้ว" }).click();
  await expect(page.locator(".player-hero h1")).toHaveText("Police");
});

test("player summary stays readable until manual exit, even after closure and reload at 360px", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 360, height: 800 });
  await openPlayer(page, "villager");
  await expect(page.locator(".end-game-summary")).toHaveCount(0);
  await f.hit("killer-wife");
  await f.hit("killer-wife");
  await f.resetQuota();
  await f.hit("police");
  await f.hit("police");
  await db.query("update public.players set name=$1 where id=$2", ["ผู้เล่นชื่อยาวสำหรับทดสอบ", f.players.sumo]);
  await f.as("host", "end_game", ["ABCDEF"]);
  const summary = page.locator(".end-game-summary");
  await expect(summary).toBeVisible({ timeout: 20000 });
  await expect(summary.locator(".game-ended-notice")).toContainText("จบเกมโดยไม่มีผู้ชนะ");
  await expect(summary.locator(".end-game-player")).toHaveCount(Object.keys(f.players).length);
  await expect(summary.locator(".end-game-role-caption")).toHaveCount(Object.keys(f.players).length);
  await expect(summary.locator(".role-thumb-endgame")).toHaveCount(Object.keys(f.players).length);
  for (const role of Object.keys(f.players).filter((role) => role !== "sumo"))
    await expect(summary.locator(".end-game-player-details strong", { hasText: role })).toHaveCount(role === "killer" ? 2 : 1);
  await expect(summary).toContainText("Detective → Police");
  const converted = summary.locator(".end-game-player", { hasText: "killer-wife" });
  await expect(converted).toContainText("Killer's Wife → Killer");
  await expect(converted).toContainText("ฝ่าย Killer");
  await expect(page.locator(".player-hero")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(6000);
  await expect(page).toHaveURL(/\/room\/ABCDEF/);
  await expect(summary).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("end-game-summary-360.png"), fullPage: true });
  await f.as("host", "close_room", ["ABCDEF"]);
  await expect(summary).toContainText("Host ปิดห้องแล้ว คุณยังอ่านสรุปนี้ได้", { timeout: 20000 });
  await page.reload();
  await expect(summary).toBeVisible();
  await expect(summary.locator(".end-game-player")).toHaveCount(Object.keys(f.players).length);
  await expect(summary).toContainText("villager (คุณ)");
  await page.getByRole("button", { name: "กลับหน้าแรก", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect(await page.evaluate(() => localStorage.getItem("killer_active_room"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("killer_room_cred:player:ABCDEF"))).toBeNull();
});

for (const [target, winner, personal] of [
  ["killer", "ฝ่ายเมืองชนะ", "คุณชนะ"],
  ["sumo", "ฝ่าย Killer ชนะ", "คุณแพ้"],
]) {
  test(`player summary shows ${winner} after Police accusation`, async ({ page }) => {
    await openPlayer(page, "villager");
    await db.exec("update public.rooms set phase='police-check'");
    await f.as("police", "resolve_police_check", ["ABCDEF", f.players[target]]);
    await expect(page.locator(".end-game-summary")).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".game-ended-notice")).toContainText(winner);
    await expect(page.locator(".game-ended-notice h2")).toHaveText(personal);
    await page.reload();
    await expect(page.locator(".end-game-summary")).toBeVisible();
    await expect(page.locator(".game-ended-notice h2")).toHaveText(personal);
  });
}

test("player sees unassigned roles when Host ends before dealing", async ({ page }) => {
  await openPlayer(page, "villager");
  await db.exec("delete from public.player_secrets; update public.rooms set phase='lobby'");
  await f.as("host", "end_game", ["ABCDEF"]);
  await expect(page.locator(".end-game-summary")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".game-ended-notice")).toContainText("จบเกมโดยไม่มีผู้ชนะ");
  await expect(page.getByText("ยังไม่ได้รับบทบาท", { exact: true })).toHaveCount(Object.keys(f.players).length);
  await page.getByRole("button", { name: "กลับหน้าแรก", exact: true }).click();
  await expect(page).toHaveURL("/");
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

test("anonymous attack news and event colors respect audience at mobile and desktop sizes", async ({
  page,
}) => {
  await openPlayer(page, "athlete");
  await f.hit("sumo");
  await page.getByRole("button", { name: "ข่าวสาร", exact: true }).click();
  const row = page
    .locator(".tab-content .event-row")
    .filter({ hasText: "มีคนถูกโจมตีจาก Killer" });
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toHaveClass(/event-tone-danger/);
  await expect(row.locator("p")).toHaveText("มีคนถูกโจมตีจาก Killer");
  await expect(row).not.toContainText("sumo");
  await expect(page.locator(".tab-content")).not.toContainText("เสียหัวใจ");
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
