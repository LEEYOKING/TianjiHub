"""抓 stat card 实际值"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("http://localhost:5094/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(8000)
        txt = await page.evaluate("() => document.body.innerText")
        for i, line in enumerate(txt.split('\n')):
            if i < 40:
                print(f'  {i}: {line!r}')
        await browser.close()

asyncio.run(main())
