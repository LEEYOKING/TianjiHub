"""看本地 server 5092 svg"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("http://localhost:5092/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(8000)
        svgs = await page.evaluate("""() => {
            const out = [];
            for (const svg of document.querySelectorAll('svg')) {
                out.push(svg.textContent || '');
            }
            return out;
        }""")
        for i, t in enumerate(svgs):
            print(f'--- SVG #{i} ({len(t)} chars) ---')
            print(t[:300])
        await page.screenshot(path="_shots14/v199j_overview.png", full_page=False)
        await browser.close()

asyncio.run(main())
