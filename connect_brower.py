from selenium import webdriver
from selenium.webdriver.edge.options import Options

def connect_to_edge():
    """
    启动Edge浏览器，控制台输入URL后打开网页
    """
    options = Options()
    options.add_argument("--start-maximized")
    options.add_argument("--disable-infobars")

    print("正在启动Edge浏览器...")

    try:
        driver = webdriver.Edge(options=options)
        print("Edge浏览器启动成功！")

        return driver

    except Exception as e:
        print(f"启动浏览器失败: {str(e)}")
        raise

