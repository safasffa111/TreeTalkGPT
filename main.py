import os
import time
from connect_brower import connect_to_edge
from screenshot import get_full_screenshot
from analyze_screenshots import main as analyze_main
from clean_screenshots import clean_screenshots as clean_main

def main():
    """
    主函数，实现网页长截图功能
    """
    try:
        # 连接到已打开的Edge浏览器
        print("正在连接到Edge浏览器...")
        driver = connect_to_edge()
        print("连接成功！")
        
        # 创建保存截图的文件夹
        save_dir = "screenshots"
        if not os.path.exists(save_dir):
            os.makedirs(save_dir)
            print(f"创建文件夹: {save_dir}")
        
        # 生成截图文件名
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        output_path = os.path.join(save_dir, f"screenshot_{timestamp}.png")
        time.sleep(30)
        # 执行长截图
        print("正在执行长截图...")
        success = get_full_screenshot(driver, output_path)
        
        if success:
            print("长截图完成！")
        else:
            print("长截图失败！")
            
    except Exception as e:
        print(f"发生错误: {str(e)}")
        print("请确保Edge浏览器已以调试模式启动（命令：msedge.exe --remote-debugging-port=9222）")
    finally:
        # 不关闭浏览器，因为是连接到已打开的浏览器
        pass

if __name__ == "__main__":
    main()
    analyze_main()
    clean_main()