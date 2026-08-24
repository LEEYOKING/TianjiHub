"""看 SVG 实际渲染"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("https://qtm7van447f1y.space.mcode.cn/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(8000)
        # 找所有 svg 文本
        svgs_text = await page.evaluate("""() => {
            const out = [];
            for (const svg of document.querySelectorAll('svg')) {
                const txt = svg.textContent || '';
                if (txt.length > 10) out.push(txt);
            }
            return out;
        }""")
        for i, t in enumerate(svgs_text):
            print(f'--- SVG #{i} ({len(t)} chars) ---')
            print(t[:500])
        await browser.close()

asyncio.run(main())
