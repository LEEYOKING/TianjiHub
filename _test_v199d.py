"""看 network 实际请求"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        # 拦截所有 data.json 请求
        async def on_response(resp):
            if 'data.json' in resp.url:
                text = await resp.text()
                import re
                m = re.search(r'"upCount":\s*(\d+)', text)
                n = re.search(r'"marketTurnover":\s*([\d.]+)', text)
                print(f'  data.json from {resp.url[:60]} → up={m.group(1) if m else "?"} turnover={n.group(1) if n else "?"}')
        page.on("response", lambda r: asyncio.create_task(on_response(r)))
        await page.goto("http://localhost:5091/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(3500)
        # 等 30s 看 60s reload 是否拉新
        print("  waiting 65s for 60s reload...")
        await page.wait_for_timeout(65000)
        await browser.close()

asyncio.run(main())
