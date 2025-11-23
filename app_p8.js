// app_p6.js
// 숲나들e 자동 예약 시스템 (환경변수 미사용, 강제 설정 버전)
// 기능: 로그인 -> 09:00 대기 -> 예약 -> Node.js 내부 OCR -> 완료

const puppeteer = require('puppeteer');
const { execFile } = require('child_process');
const https = require('https');
const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

// =======================================================
// ⭐️ [설정 구역] 이 부분만 본인 환경에 맞게 수정하세요
// =======================================================

// 1. 로그인 정보 (직접 입력)
const LOGIN_ID = 'sandi119';
const LOGIN_PWD = '1qaz2wsx#EDC';

// 2. Tesseract 설치 경로 (내 컴퓨터에 설치된 실제 경로)
// (일반적인 설치 경로는 아래와 같습니다. 다르면 수정하세요.)
const TESS_PATH = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
const TESS_DATA_DIR = "D:\\workspace\\project\\my_reserve\\test_reserve\\tessdata";

// 3. 목표 시간 (오전 9시 00분 00초)
const TARGET_HOUR = 9;
const TARGET_MINUTE = 0;
const TARGET_SECOND = 0;

// 4. 자동화 옵션
const AUTO_CAPTCHA = true; // 자동 인식 시도 여부
const AUTO_SUBMIT = true;  // 예약 버튼 자동 클릭 여부

// =======================================================

const loginPageUrl = 'https://www.foresttrip.go.kr/com/login.do';
const CAPTCHA_INPUT_SELECTOR = '#atmtcRsrvtPrvntChrct';
const CAPTCHA_IMG_SELECTOR = '#captchaImg';

// [함수] 사용자 입력 받기 (수동 모드)
function ask(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

// [함수] 예약 버튼 클릭
async function clickReserve(page) {
    await page.click('#btnRsrvt');
}

// [함수] 캡차 인식 (Tesseract 직접 실행)
async function recognizeCaptcha(page, imgSelector, tessPath) {
    try {
        const el = await page.$(imgSelector);
        if (!el) {
            console.log("[captcha] 이미지 요소를 찾지 못했습니다.");
            return null;
        }

        // 이미지 로드 대기
        await page.waitForFunction((sel) => {
            const img = document.querySelector(sel);
            return img && img.complete && img.naturalWidth > 0;
        }, {}, imgSelector);

        // 폴더 생성
        const saveDir = "captchas";
        await fs.mkdir(saveDir, { recursive: true });
        const ts = Date.now();

        // 스크린샷
        const rawTemp = `captcha_temp_${ts}.png`;
        await el.screenshot({ path: rawTemp });

        // 전처리 파일 경로
        const processedPath = path.join(saveDir, `${ts}_processed.png`);

        // 이미지 전처리 (sharp)
        await sharp(rawTemp)
            .greyscale()
            .linear(1.15, -10)
            .toFile(processedPath);

        // 임시 파일 삭제
        await fs.unlink(rawTemp).catch(() => {});

        // Tesseract 실행
        return new Promise((resolve) => {
            execFile(
                tessPath, // 실행 파일 경로 (강제 지정된 상수 사용)
                [
                    processedPath,
                    "stdout",
                    "-l", "custom",
                    "--psm", "13",
                    "-c", "tessedit_char_whitelist=0123456789",
                    "-c", "tessedit_zero_rejection=1"
                ],
                {
                    // ⭐️ 여기가 핵심: 환경 변수를 사용하지 않고, 코드에 적힌 경로를 강제로 주입
                    env: {
                        ...process.env, // 시스템 기본 환경변수는 유지 (윈도우 동작용)
                        TESSDATA_PREFIX: TESS_DATA_DIR // 데이터 경로 강제 덮어쓰기
                    }
                },
                (err, stdout) => {
                    if (err) {
                        console.log("[captcha] OCR 실행 에러:", err.message);
                        resolve(null);
                    } else {
                        // 결과에서 공백 제거 후 숫자만 추출
                        const text = stdout.trim().replace(/\s/g, "");
                        resolve(text);
                    }
                }
            );
        });

    } catch (err) {
        console.log("[captcha-error]", err);
        return null;
    }
}

// [함수] 네이버 서버 시간 가져오기
function getNaverServerTime() {
    return new Promise((resolve) => {
        https.request('https://www.naver.com', { method: 'HEAD' }, (res) => {
            if (res.headers.date) resolve(new Date(res.headers.date));
            else resolve(new Date());
        }).on('error', () => resolve(new Date())).end();
    });
}

// [함수] 정각 대기 로직
async function waitAndShoot(targetHour, targetMinute, targetSecond) {
    console.log(`\n⏳ [동기화] 네이버 서버 시간 기준 ${targetHour}시 ${targetMinute}분 ${targetSecond}초 대기 중...`);
    while (true) {
        const now = await getNaverServerTime();
        const target = new Date(now);
        target.setHours(targetHour, targetMinute, targetSecond, 0);

        if (now > target) {
            console.log(`⏰ 목표 시간 도달! 실행합니다!`);
            break;
        }
        const diff = target.getTime() - now.getTime();
        if (diff > 60000) {
            console.log(`   ...${(diff / 60000).toFixed(1)}분 전`);
            await new Promise(r => setTimeout(r, 10000));
        } else if (diff > 0) {
            process.stdout.write(`\r🚀 카운트다운: ${(diff / 1000).toFixed(1)}초   `);
            await new Promise(r => setTimeout(r, 100));
        } else {
            console.log('\n⚡️⚡️⚡️ GO! ⚡️⚡️⚡️');
            break;
        }
    }
}

(async () => {
    console.log('🚀 자동 예약 브라우저 시작 (강제 설정 모드)');
    console.log(`   - Tesseract 경로: ${TESS_PATH}`);
    console.log(`   - 데이터 경로: ${TESS_DATA_DIR}`);

    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: false, 
            defaultViewport: { width: 1280, height: 800 } 
        });
        
        const page = await browser.newPage();
        
        // 1. 로그인
        console.log(`로그인 이동: ${loginPageUrl}`);
        await page.goto(loginPageUrl, { waitUntil: 'networkidle0' });
        
        await page.type('#mmberId', LOGIN_ID);
        await page.type('#gnrlMmberPssrd', LOGIN_PWD);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.click('.loginBtn')
        ]);

        if (page.url().includes('/main.do')) {
            console.log('✅ 로그인 성공');

            // 2. 지역/휴양림 선택
            console.log('지역(충북) -> 휴양림(소백산) 선택...');
            await page.click('.preview_wrap.locate .yeyakSearchName');
            await page.waitForSelector('#srch_region', { visible: true });
            
            const regionLinks = await page.$$('#srch_region ul li a');
            for (const link of regionLinks) {
                if (await link.evaluate(el => el.textContent.trim()) === '충북') {
                    await link.click();
                    break;
                }
            }

            await page.waitForSelector('.preview_wrap.name .yeyakSearchName');
            await page.click('.preview_wrap.name .yeyakSearchName');
            await page.waitForSelector('#srch_rcfcl ul li a', { visible: true });
            
            const facilityLinks = await page.$$('#srch_rcfcl ul li a');
            let targetFacilityLink = null;
            for (const link of facilityLinks) {
                if ((await link.evaluate(el => el.textContent)).includes('(단양군)소백산자연휴양림')) {
                    targetFacilityLink = link;
                    break;
                }
            }

            if (targetFacilityLink) {
                const pagesBefore = await browser.pages();
                await targetFacilityLink.click();
                await new Promise(r => setTimeout(r, 3000));
                const pagesAfter = await browser.pages();
                let calendarPage = pagesAfter.length > pagesBefore.length ? pagesAfter[pagesAfter.length - 1] : page;
                if (calendarPage !== page) await calendarPage.bringToFront();

                // 3. 날짜 선택
                console.log('📅 날짜 선택 중...');
                await calendarPage.click('#calPicker');
                await calendarPage.waitForSelector('.cal_left', { visible: true });

                // 날짜 변경이 필요하면 여기를 수정하세요
                const checkIn = '5';
                const checkOut = '6';

                const dayLinks = await calendarPage.$$('tbody a[data-date]');
                for (const link of dayLinks) {
                    if (await link.evaluate(el => el.textContent.trim()) === checkIn) {
                        await link.click();
                        break;
                    }
                }
                const outLinks = await calendarPage.$$('tbody a[data-date]');
                for (const link of outLinks) {
                    if (await link.evaluate(el => el.textContent.trim()) === checkOut) {
                        await link.click();
                        break;
                    }
                }

                await calendarPage.click('.defBtn.board'); 
                await calendarPage.waitForSelector('.cal_left', { hidden: true });
                
                console.log('✅ 날짜 세팅 완료. 9시 대기 진입...');
                
                // 4. 정밀 타격 대기
                await waitAndShoot(TARGET_HOUR, TARGET_MINUTE, TARGET_SECOND);

                // 5. 조회
                console.log('💥 조회 클릭!');
                await Promise.all([
                    calendarPage.waitForNavigation({ waitUntil: 'networkidle0' }),
                    calendarPage.click('.s_2_btn button[title="조회하기"]')
                ]);

                // 6. 방 찾기
                console.log('🔍 "중선암" 탐색...');
                calendarPage.on('dialog', async dialog => {
                    console.log(`🚨 팝업: "${dialog.message()}" -> 수락`);
                    await dialog.accept();
                });
                
                try { await calendarPage.waitForSelector('.list_box', { timeout: 5000 }); } catch(e) {}

                const targetRoomName = '중선암';
                const roomBoxes = await calendarPage.$$('.list_box');
                let isBooked = false;

                for (const box of roomBoxes) {
                    const nameEl = await box.$('.opt1');
                    if (!nameEl) continue;
                    const roomText = await calendarPage.evaluate(el => el.innerText, nameEl);
                    
                    if (roomText.includes(targetRoomName)) {
                        const btn = await box.$('.btn_group .defBtn.board');
                        if (btn) {
                            const status = await calendarPage.evaluate(anchor => {
                                const span = anchor.querySelector('.txtRsrvt');
                                return (span && window.getComputedStyle(span).display !== 'none') ? 'GO' : 'STOP';
                            }, btn);

                            if (status === 'GO') {
                                console.log('✨ 예약 가능! 클릭!');
                                await calendarPage.evaluate(el => el.click(), btn);
                                isBooked = true;
                                break;
                            }
                        }
                    }
                }

                if (isBooked) {
                    console.log('--- Step 7: 약관/보안문자 처리 ---');
                    await new Promise(r => setTimeout(r, 2000));

                    // 약관 동의
                    const agreeCheckbox = await calendarPage.$('#arr_01');
                    if (agreeCheckbox) {
                        const isChecked = await calendarPage.evaluate(el => el.checked, agreeCheckbox);
                        if (!isChecked) await calendarPage.evaluate(el => el.click(), agreeCheckbox);
                        console.log('✅ 약관 동의 완료');
                    }

                    // 보안문자 처리
                    await calendarPage.focus(CAPTCHA_INPUT_SELECTOR);
                    let captchaCode = "";

                    if (AUTO_CAPTCHA) {
                        console.log("[captcha] 자동 인식 시작...");
                        // 경로 상수들을 직접 함수에 전달
                        captchaCode = (await recognizeCaptcha(calendarPage, CAPTCHA_IMG_SELECTOR, TESS_PATH)) || "";
                        
                        if (captchaCode) {
                            console.log(`[captcha] 인식 성공: "${captchaCode}"`);
                        } else {
                            console.log("[captcha] 인식 실패. 직접 입력하세요.");
                            captchaCode = await ask(">> Captcha 입력: ");
                        }
                    } else {
                        captchaCode = await ask(">> Captcha 입력: ");
                    }

                    if (captchaCode) {
                        await calendarPage.type(CAPTCHA_INPUT_SELECTOR, captchaCode);
                        console.log("[captcha] 입력 완료");

                        if (AUTO_SUBMIT) {
                            await clickReserve(calendarPage);
                            console.log("[final] 예약 버튼 자동 클릭 완료!");
                        } else {
                            console.log("[final] 예약 버튼 클릭 대기 중 (직접 누르세요)");
                        }
                    }
                    
                    console.log('결과 확인을 위해 대기합니다...');
                    await new Promise(() => {}); 

                } else {
                    console.error('❌ 예약 실패: 방을 못 찾았습니다.');
                }
            }
        }
    } catch (err) {
        console.error('오류:', err);
    }
})();