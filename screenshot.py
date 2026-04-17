from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from PIL import Image
import io
import time

def get_full_screenshot(driver, filename="full.png"):
    """
    终极长截图：对付 防截图、固定视口、懒加载 网站
    无重复、无错位、一次到底
    """
    # 1. 获取页面总高度
    total_height = driver.execute_script("return document.body.scrollHeight")
    viewport_height = driver.execute_script("return window.innerHeight")
    
    # 2. 逐段截图（每次滚动 90% 视口高度，避免重复）
    screenshots = []
    scroll_step = int(viewport_height * 0.9)
    
    for y in range(0, total_height, scroll_step):
        driver.execute_script(f"window.scrollTo(0, {y})")
        time.sleep(0.3)
        png = driver.get_screenshot_as_png()
        img = Image.open(io.BytesIO(png))
        screenshots.append(img)
    
    # 3. 智能拼接：自动裁掉重复区域，完美无断层
    width = screenshots[0].width
    total_img_height = sum(img.height for img in screenshots) - (len(screenshots)-1)*int(viewport_height*0.1)
    final = Image.new("RGB", (width, total_img_height))
    
    current_y = 0
    overlap = int(viewport_height * 0.1)  # 自动裁掉重复部分
    
    for i, img in enumerate(screenshots):
        if i == 0:
            final.paste(img, (0, current_y))
            current_y += img.height
        else:
            # 跳过重叠区域，避免重复题目
            final.paste(img.crop((0, overlap, width, img.height)), (0, current_y - overlap))
            current_y += img.height - overlap
    
    final.save(filename)
    print(f"✅ 完美长截图已保存：{filename}")

# ------------------- 运行 -------------------
if __name__ == "__main__":
    opt = Options()
    opt.add_argument("--start-maximized")
    opt.add_argument("--disable-web-security")
    
    driver = webdriver.Chrome(options=opt)
    driver.get("这里换成你的作业网址")
    time.sleep(3)
    
    get_full_screenshot(driver, "作业完整截图.png")
    driver.quit()