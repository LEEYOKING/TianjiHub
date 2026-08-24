"""
playwright 截屏对比生产 + 沙箱 (移动端 + PC 端)
"""
import asyncio
from playwright.async_api import async_playwright
import os

OUT = '/workspace/fupan/data/probe/screenshot-compare'
os.makedirs(OUT, exist_ok=True)

PROD = 'https://tianjishu-a-6is.pages.dev/'
SANDBOX = 'http://localhost:4173/'

PAGES = [
    ('overview', '/overview'),
    ('limit-up', '/limit-up'),
    ('sector', '/sector'),
    ('dragon-tiger', '/dragon-tiger'),
    ('surgery', '/surgery'),
]

async def shoot(p, name, url, w, h):
    browser = await p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
    ctx = await browser.new_context(viewport={'width': w, 'height': h})
    page = await ctx.new_page()
    # v2.0.7fv:沙箱 http.server 不支持 SPA fallback,先访问 / 再 history.pushState
    if 'localhost' in url or '4173' in url:
        await page.goto(url.split('overview')[0].split('sector')[0].split('dragon-tiger')[0].split('surgery')[0].split('limit-up')[0].rstrip('/') + '/', wait_until='networkidle', timeout=20000)
        target = url.split('localhost:4173')[-1] if 'localhost:4173' in url else url.split('4173/')[-1]
        if target and target != '/':
            await page.evaluate(f"history.pushState({{}}, '', '{target}'); window.dispatchEvent(new PopStateEvent('popstate'))")
    else:
        await page.goto(url, wait_until='networkidle', timeout=20000)
    await page.wait_for_timeout(2000)
    fname = f"{OUT}/{name}-w{w}.png"
    await page.screenshot(path=fname, full_page=True)
    print(f"  {name} w={w} → {fname}")
    await browser.close()

async def main():
    async with async_playwright() as p:
        print("=== 移动端 375x812 ===")
        for page_name, path in PAGES:
            await shoot(p, f"sandbox-{page_name}", SANDBOX + path[1:], 375, 812)
            await shoot(p, f"prod-{page_name}", PROD + path[1:], 375, 812)
        print("\n=== PC 端 1440x900 ===")
        for page_name, path in PAGES[:3]:
            await shoot(p, f"sandbox-{page_name}", SANDBOX + path[1:], 1440, 900)
            await shoot(p, f"prod-{page_name}", PROD + path[1:], 1440, 900)

asyncio.run(main())
print("done")
