// app_p6.js
// 숲나들e 자동 예약 시스템 (네이버 서버시간 정밀 타격 + Node.js Native OCR)
// 기능: 로그인 -> 09:00 대기 -> 중선암 찾기 -> 예약 -> (sharp + tesseract) 보안문자 -> 최종예약

const puppeteer = require('puppeteer');
const { execFile } = require('child_process'); // tesseract 실행용
const https = require('https');
const readline = require('readline');
const fs = require('fs').promises; // 파일 시스템 (Promise 기반)
const path = require('path');
const sharp = require('sharp'); // ⭐️ npm install sharp 필수!

// ⭐️ 로그인 정보
const loginId = 'sandi119';
const loginPwd = '1qaz2wsx#EDC';
const loginPageUrl = 'https://www.foresttrip.go.kr/com/login.do';

// ⭐️ 목표 시간 설정 (오전 9시 00분 00초)
const TARGET_HOUR = 9;
const TARGET_MINUTE = 0;
const TARGET_SECOND = 0;

// ⭐️ 자동화 설정
const AUTO_CAPTCHA = true; // true: 자동 인식 시도, false: 수동 입력
const AUTO_SUBMIT = true;  // true: 입력 후 자동 클릭, false: 대기

// ⭐️ Tesseract 경로 및 선택자 상수
const TESS_PATH = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
const CAPTCHA_INPUT_SELECTOR = '#atmtcRsrvtPrvntChrct';
const CAPTCHA_IMG_SELECTOR = '#captchaImg';

// [함수] 사용자 콘솔 입력 받기
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

// [함수] 예약 버튼 클릭 헬퍼
async function clickReserve(page) {
    await page.click('#btnRsrvt');
}

// [함수] 캡차 인식 (요청하신 코드 반영 - sharp 사용)
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
            return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
        }, {}, imgSelector);

        // 저장 폴더
        const saveDir = "captchas";
        await fs.mkdir(saveDir, { recursive: true });

        const ts = Date.now();

        // raw 임시 파일 (OCR 전처리용으로만 사용)
        const rawTemp = `captcha_temp_${ts}.png`;
        await el.screenshot({ path: rawTemp });

        // 최종 저장될 processed 파일
        const processedPath = path.join(saveDir, `${ts}_processed.png`);

        // ----------------------------
        //  🔥 전처리 (sharp 사용)
        // ----------------------------
        await sharp(rawTemp)
            .greyscale()
            .linear(1.15, -10)     // 약한 대비 증가
            .toFile(processedPath);

        console.log("[captcha] processed 저장:", processedPath);

        // raw 임시파일 삭제
        await fs.unlink(rawTemp).catch(() => {});

        // ----------------------------
        //  🔥 Tesseract OCR 실행
        // ----------------------------
        return new Promise((resolve) => {
            execFile(
                tessPath,
                [
                    processedPath,
                    "stdout",
                    "-l", "eng", // 'custom' 대신 기본 'eng' 사용 (숫자는 eng로 충분)
                    "--psm", "13", // Raw Line 모드
                    "-c", "tessedit_char_whitelist=0123456789",
                    "-c", "tessedit_zero_rejection=1"
                ],
                {
                    env: {
                        ...process.env,
                        // Tesseract 데이터 경로 설정 (필요시 수정)
                        TESSDATA_PREFIX: process.env.TESSDATA_PREFIX || "C:\\Program Files\\Tesseract-OCR\\tessdata",
                    }
                },
                (err, stdout) => {
                    if (err) {
                        console.log("[captcha] OCR 실패:", err.message);
                        resolve(null);
                    } else {
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
    return new Promise((resolve, reject) => {
        https.request('https://www.naver.com', { method: 'HEAD' }, (res) => {
            if (res.headers.date) resolve(new Date(res.headers.date));
            else resolve(new Date());
        }).on('error', () => resolve(new Date())).end();
    });
}

// [함수] 정각 대기
async function waitAndShoot(targetHour, targetMinute, targetSecond) {
    console.log(`\n⏳ [동기화] 네이버 서버 시간을 기준으로 ${targetHour}시 ${targetMinute}분 ${targetSecond}초를 기다립니다...`);
    while (true) {
        const now = await getNaverServerTime();
        const target = new Date(now);
        target.setHours(targetHour, targetMinute, targetSecond, 0);

        if (now > target) {
            console.log(`⏰ 현재 시간(${now.toLocaleTimeString()})이 목표 시간을 지났습니다. 즉시 실행합니다!`);
            break;
        }
        const diff = target.getTime() - now.getTime();
        if (diff > 60000) {
            console.log(`   ...아직 ${(diff / 60000).toFixed(1)}분 남았습니다. 대기 중...`);
            await new Promise(r => setTimeout(r, 10000));
        } else if (diff > 0) {
            process.stdout.write(`\r🚀 카운트다운: ${(diff / 1000).toFixed(1)}초 전...   `);
            await new Promise(r => setTimeout(r, 100));
        } else {
            console.log('\n⚡️⚡️⚡️ [GO] 목표 시간 도달! 발사! ⚡️⚡️⚡️');
            break;
        }
    }
}

(async () => {
    console.log('🚀 완전 자동화 브라우저를 실행합니다...');
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: false, 
            defaultViewport: { width: 1280, height: 800 } 
        });
        
        const page = await browser.newPage();
        
        // 1. 로그인
        console.log(`로그인 페이지 이동: ${loginPageUrl}`);
        await page.goto(loginPageUrl, { waitUntil: 'networkidle0' });
        await page.type('#mmberId', loginId);
        await page.type('#gnrlMmberPssrd', loginPwd);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.click('.loginBtn')
        ]);

        if (page.url().includes('/main.do')) {
            console.log('✅ 로그인 성공!');

            // 2. 지역/휴양림 선택
            console.log('지역(충북) -> 휴양림(소백산) 선택 중...');
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
                
                console.log('✅ 날짜 세팅 완료. 이제 9시가 될 때까지 대기합니다.');

                // ⭐️ 09:00 정밀 타격 대기
                await waitAndShoot(TARGET_HOUR, TARGET_MINUTE, TARGET_SECOND);

                // 4. 조회 버튼 클릭
                console.log('💥 조회 시작!');
                await Promise.all([
                    calendarPage.waitForNavigation({ waitUntil: 'networkidle0' }),
                    calendarPage.click('.s_2_btn button[title="조회하기"]')
                ]);

                // 5. 방 찾기 및 예약 클릭
                console.log('🔍 "중선암" 방 찾는 중...');
                calendarPage.on('dialog', async dialog => {
                    console.log(`🚨 팝업 감지: "${dialog.message()}" -> 수락`);
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
                                console.log('✨ 예약 가능! 버튼 클릭!');
                                await calendarPage.evaluate(el => el.click(), btn);
                                isBooked = true;
                                break;
                            }
                        }
                    }
                }

                if (isBooked) {
                    console.log('--- Step 7: 약관 동의 및 보안문자 처리 ---');
                    await new Promise(r => setTimeout(r, 2000));

                    // 약관 동의
                    const agreeCheckbox = await calendarPage.$('#arr_01');
                    if (agreeCheckbox) {
                        const isChecked = await calendarPage.evaluate(el => el.checked, agreeCheckbox);
                        if (!isChecked) await calendarPage.evaluate(el => el.click(), agreeCheckbox);
                        console.log('✅ 약관 동의 완료');
                    }

                    // ============================================================
                    // ⭐️ Step 7: 요청하신 로직 반영 (자동/수동 전환 및 처리)
                    // ============================================================
                    await calendarPage.focus(CAPTCHA_INPUT_SELECTOR);
                    let captchaCode = "";

                    if (AUTO_CAPTCHA) {
                        console.log("[captcha] 자동 인식 시작");
                        captchaCode = (await recognizeCaptcha(calendarPage, CAPTCHA_IMG_SELECTOR, TESS_PATH)) || "";
                        
                        if (captchaCode) {
                            console.log(`[captcha] 인식 결과: "${captchaCode}"`);
                        } else {
                            console.log("[captcha] 인식 실패 수동 입력으로 전환");
                            // 인식 실패 시 알림음이나 강조 표시를 추가할 수 있습니다.
                            captchaCode = await ask(">> 화면을 보고 보안문자를 입력해주세요(Captcha): ");
                        }
                    } else {
                        captchaCode = await ask(">> 화면을 보고 보안문자를 입력해주세요(Captcha): ");
                    }

                    if (captchaCode) {
                        await calendarPage.type(CAPTCHA_INPUT_SELECTOR, captchaCode);
                        console.log("[captcha] 입력 완료");

                        if (AUTO_SUBMIT) {
                            await clickReserve(calendarPage);
                            console.log("[final] AUTO_SUBMIT=1 예약 버튼 자동 클릭 완료");
                        } else {
                            console.log("[final] AUTO_SUBMIT=0 예약 버튼 클릭 대기 중 (직접 누르세요)");
                        }
                    } else {
                        console.log("[captcha] 캡차 입력이 비어 있음 예약 대기");
                    }
                    // ============================================================

                    console.log('결과 확인을 위해 대기중... (강제종료하려면 Ctrl+C)');
                    await new Promise(() => {}); 

                } else {
                    console.error('❌ 예약 실패: 방을 못 찾았거나 매진되었습니다.');
                }
            }
        }
    } catch (err) {
        console.error('오류 발생:', err);
    }
})();