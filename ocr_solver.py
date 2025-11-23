# -*- coding: utf-8 -*-
import cv2
import pytesseract
import numpy as np
import os
import sys

# 윈도우 콘솔 출력 인코딩 강제 설정
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def find_tesseract_path():
    possible_paths = [
        r'C:\Program Files\Tesseract-OCR\tesseract.exe',
        r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
        os.path.expanduser(r'~\AppData\Local\Tesseract-OCR\tesseract.exe'),
        os.path.expanduser(r'~\AppData\Local\Programs\Tesseract-OCR\tesseract.exe')
    ]
    for path in possible_paths:
        if os.path.exists(path): return path
    return r'C:\Program Files\Tesseract-OCR\tesseract.exe'

pytesseract.pytesseract.tesseract_cmd = find_tesseract_path()

# -------------------------------------------------------------
# 전략 1: 강력한 노이즈 제거 (가로줄/세로선 필터링)
# -------------------------------------------------------------
def preprocess_strategy_1(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 25, 10)
    inverted = cv2.bitwise_not(thresh)
    
    # 세로 성분 강조
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 3))
    opened = cv2.morphologyEx(inverted, cv2.MORPH_OPEN, vertical_kernel)
    
    # 끊어진 선 연결
    dilate_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    dilated = cv2.dilate(opened, dilate_kernel, iterations=1)
    
    final_img = cv2.bitwise_not(dilated)
    return final_img

# -------------------------------------------------------------
# 전략 2: 표준 이진화 (Adaptive Threshold)
# -------------------------------------------------------------
def preprocess_strategy_2(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # 단순 이진화보다 조금 더 부드럽게 처리
    final_img = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, 5)
    return final_img

# -------------------------------------------------------------
# 전략 3: 단순 확대 및 그레이스케일 (원본이 깨끗할 때 유리)
# -------------------------------------------------------------
def preprocess_strategy_3(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Otsu 이진화 (자동 임계값)
    _, final_img = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return final_img

def solve_captcha(image_path):
    stream = open(image_path, "rb")
    bytes = bytearray(stream.read())
    numpyarray = np.asarray(bytes, dtype=np.uint8)
    base_image = cv2.imdecode(numpyarray, cv2.IMREAD_UNCHANGED)
    
    if base_image is None: return ""

    # 투명 배경 처리
    if base_image.shape[2] == 4:
        trans_mask = base_image[:, :, 3] == 0
        base_image[trans_mask] = [255, 255, 255, 255]
        base_image = cv2.cvtColor(base_image, cv2.COLOR_BGRA2BGR)

    # 공통: 이미지 확대 (2배)
    base_image = cv2.resize(base_image, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)

    # 3가지 전략 순차 시도
    strategies = [preprocess_strategy_1, preprocess_strategy_2, preprocess_strategy_3]
    
    for i, strategy in enumerate(strategies):
        processed_img = strategy(base_image.copy())
        
        # 여백 추가 (인식률 향상 필수)
        processed_img = cv2.copyMakeBorder(processed_img, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[255, 255, 255])
        
        # 디버깅용 저장 (어떤 전략이 먹혔는지 확인 가능)
        # cv2.imwrite(f"debug_strategy_{i+1}.png", processed_img)

        custom_config = r'--oem 3 --psm 7 -c tessedit_char_whitelist=0123456789'
        text = pytesseract.image_to_string(processed_img, config=custom_config)
        digits = ''.join(filter(str.isdigit, text))
        
        # 4자리 이상의 숫자가 나오면 즉시 반환 (성공으로 간주)
        if len(digits) >= 4:
            return digits

    return "" # 실패 시 빈 문자열

if __name__ == "__main__":
    if len(sys.argv) > 1:
        target_path = sys.argv[1]
    else:
        target_path = "captcha_target.png"

    if os.path.exists(target_path):
        result = solve_captcha(target_path)
        print(result)
    else:
        print("")