"""看 history 实际值"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("http://localhost:5092/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(5000)
        # 抓 echarts 实际 data
        result = await page.evaluate("""() => {
            const charts = window.echarts?.getInstanceByDom?.(document.querySelectorAll('[_echarts_instance_]')[0]) || null;
            return 'no echarts on window';
        }""")
        # 查 PageHeader 显示的 lastUpdatedAt
        txt = await page.evaluate("() => document.body.innerText")
        for line in txt.split('\n'):
            if '更新' in line or '报告日期' in line or '生成' in line:
                print(f'  {line!r}')
        # 抓 history 段
        idx = txt.find('成交量(亿)')
        print('--- context around 成交量(亿) ---')
        print(txt[idx:idx+200])
        await browser.close()

asyncio.run(main())
