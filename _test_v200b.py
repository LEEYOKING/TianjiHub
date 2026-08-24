"""v2.0 截图 + 实际卡片高度"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("http://localhost:5097/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(8000)
        # 找 4 个 echarts chart 父 Card
        info = await page.evaluate("""() => {
            const charts = document.querySelectorAll('[_echarts_instance_]');
            const out = [];
            for (const c of charts) {
                let card = c.closest('div');
                for (let i = 0; i < 10 && card; i++) {
                    if (card.style && card.style.boxShadow) break;
                    card = card.parentElement;
                }
                if (card) {
                    const rect = card.getBoundingClientRect();
                    out.push({ id: c.getAttribute('_echarts_instance_'), h: rect.height, w: rect.width, top: rect.top });
                }
            }
            return out;
        }""")
        for i in info:
            print(f"  {i['id']}: h={i['h']:.0f} top={i['top']:.0f} w={i['w']:.0f}")
        await page.screenshot(path="_shots14/v200_4charts.png", full_page=False)
        await browser.close()

asyncio.run(main())
