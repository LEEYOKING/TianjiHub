"""看已部署 v1.9.9 实际 history 渲染"""
import asyncio, re
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        # 抓 svg 文本(echarts 用 svg 渲染)
        async def on_response(resp):
            if 'data.json' in resp.url and 'space.mcode.cn' in resp.url:
                body = await resp.text()
                import json
                d = json.loads(body)
                h = d.get('history', [])
                print(f'  部署 data.json: history len={len(h)}, last 3:')
                for x in h[-3:]: print(f'    {x}')
                mo = d.get('marketOverview', {})
                print(f'  marketOverview: up={mo.get("upCount")} down={mo.get("downCount")} 成交={mo.get("marketTurnover")} 涨停={mo.get("limitUpCount")}')
        page.on("response", lambda r: asyncio.create_task(on_response(r)))
        await page.goto("https://qtm7van447f1y.space.mcode.cn/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(5000)
        # 找 svg 文本
        svg_texts = await page.evaluate("""() => {
            const svgs = document.querySelectorAll('svg');
            const out = [];
            for (const s of svgs) {
                const txt = (s.textContent || '').slice(0, 500);
                if (txt.includes('08') || txt.includes('7-') || txt.includes('07')) {
                    out.push(txt);
                }
            }
            return out;
        }""")
        for t in svg_texts:
            print(f'--- SVG text ---')
            print(t)
        await browser.close()

asyncio.run(main())
