"""看页面实际显示什么"""
import asyncio
import json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await page.goto("http://localhost:5091/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(4000)
        # 提取 page 上 textContent
        txt = await page.evaluate("() => document.body.innerText")
        # 找具体数字附近
        for line in txt.split('\n'):
            if any(k in line for k in ['成交量', '上涨家数', '下跌家数', '涨跌停', '可转债', 'ETF', '26813', '2836', '2518', '2856', '2497', '26611']):
                print(f'  {line!r}')
        await browser.close()

asyncio.run(main())
