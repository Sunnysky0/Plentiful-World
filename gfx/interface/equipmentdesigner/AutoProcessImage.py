from PIL import Image
import numpy as np
import cv2
import os

def adjust_image(img_path, output_path):
    image = Image.open(img_path).convert("RGBA")
    image_np = np.array(image)
    
    img_rgb = cv2.cvtColor(image_np[:, :, :3], cv2.COLOR_RGB2BGR)
    alpha_channel = image_np[:, :, 3]

    # Chroma 52 in HSV space
    hsv = cv2.cvtColor(img_rgb, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    h = (h - 153) % 180
    # 채도 조정
    s = cv2.convertScaleAbs(s, alpha=1, beta=182)  # 채도를 52만큼 증가
    # 다시 병합하고 BGR로 변환
    hsv = cv2.merge((h, s, v))
    img_rgb = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

    # Adjust brightness contrast using CLAHE
    lab = cv2.cvtColor(img_rgb, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    # Create and apply CLAHE
    clahe = cv2.createCLAHE(clipLimit=52.0, tileGridSize=(8, 8))
    cl = clahe.apply(l)

    # Merge and convert back to BGR
    limg = cv2.merge((cl, a, b))
    img_rgb = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
    # Brightness -45
    img_rgb = cv2.convertScaleAbs(img_rgb, alpha=1, beta=-45)

    img_bgra = cv2.merge((img_rgb, alpha_channel))
    
    # OpenCV 이미지를 PIL 이미지로 변환
    img_pil = Image.fromarray(cv2.cvtColor(img_bgra, cv2.COLOR_BGRA2RGBA))

    # DDS 형식으로 저장
    img_pil.save(output_path)

folder_path = r'C:\Program Files (x86)\Steam\steamapps\common\Hearts of Iron IV\gfx\interface\equipmentdesigner\tanks\modules'
output_folder = r'C:\Users\axur1\CodeProject\Vek-Tsarya\redflood\gfx\interface\equipmentdesigner\tanks\modules'

for filename in os.listdir(folder_path):
    if filename.endswith('.dds'):
        img_path = os.path.join(folder_path, filename)
        name_without_extension, _ = os.path.splitext(filename)
        output_path = os.path.join(output_folder, f'{name_without_extension}.dds')
        
        adjust_image(img_path, output_path)