"""v1.9.9 验证 - 5091"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await page.goto("http://localhost:5092/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(4000)
        await page.screenshot(path="_shots14/v199c_overview.png", full_page=False)
        # 提取页面实际显示值
        txt = await page.evaluate("() => document.body.innerText")
        import re
        for label, pat in [
            ('成交量', r'成交量\s*\n([\d.]+)亿'),
            ('上涨家数', r'上涨家数\s*\n(\d+)'),
            ('下跌家数', r'下跌家数\s*\n(\d+)'),
            ('涨跌停', r'涨跌停比\s*\n(\d+):(\d+)'),
            ('可转债', r'可转债涨跌分布\s*\n(\d+):(\d+)'),
            ('ETF', r'场内ETF涨跌分布\s*\n(\d+):(\d+):(\d+)'),
        ]:
            m = re.search(pat, txt)
            print(f'  {label}: {m.groups() if m else "NOT FOUND"}')
        await browser.close()

asyncio.run(main())
