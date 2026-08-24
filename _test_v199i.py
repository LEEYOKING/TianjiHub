"""直接 hook fetch 看 data.json 拉到后 history 多长"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        # 抓 data.json 内容 + 长度
        async def on_response(resp):
            if 'data.json' in resp.url:
                body = await resp.text()
                import json, re
                d = json.loads(body)
                h = d.get('history', [])
                print(f'  data.json from server: history len={len(h)}')
                print(f'  last 2: {h[-2:]}')
                # 看 meta
                print(f'  meta.tradeDate: {d.get("meta", {}).get("tradeDate")}')
                print(f'  marketOverview.upCount: {d.get("marketOverview", {}).get("upCount")}')
        page.on("response", lambda r: asyncio.create_task(on_response(r)))
        await page.goto("http://localhost:5092/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(5000)
        await browser.close()

asyncio.run(main())
