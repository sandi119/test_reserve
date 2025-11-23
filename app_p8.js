// app_p6.js
// 숲나들e 자동 예약 시스템 (완전 자동화 버전 - HTML ID 반영)
// 기능: 로그인 -> 중선암 찾기 -> 예약버튼 강제클릭 -> 약관동의 -> Python OCR로 보안문자 자동입력 -> 최종예약

const puppeteer = require('puppeteer');
const { execSync } = require('child_process'); // Python 실행을 위한 모듈
const fs = require('fs');

// ⭐️ 로그인 정보 (변경 필요)
const loginId = 'sandi119';
const loginPwd = '1qaz2wsx#EDC';
const loginPageUrl = 'https://www.foresttrip.go.kr/com/login.do';

(async () => {
    console.log('🚀 완전 자동화 브라우저를 실행합니다...');
    let browser;
    try {
        // 1. 브라우저 실행
        browser = await puppeteer.launch({ 
            headless: false, // 브라우저 창 보이기
            defaultViewport: { width: 1280, height: 800 } 
        });
        
        const page = await browser.newPage();
        
        // --- [1. 로그인] ---
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

            // --- [2. 지역/휴양림 선택] ---
            console.log('지역(충북) -> 휴양림(소백산) 선택 중...');
            
            // 지역 선택 메뉴 열기
            await page.click('.preview_wrap.locate .yeyakSearchName');
            await page.waitForSelector('#srch_region', { visible: true });
            
            // '충북' 찾아서 클릭
            const regionLinks = await page.$$('#srch_region ul li a');
            for (const link of regionLinks) {
                if (await link.evaluate(el => el.textContent.trim()) === '충북') {
                    await link.click();
                    break;
                }
            }

            // 휴양림 선택 메뉴 열기
            await page.waitForSelector('.preview_wrap.name .yeyakSearchName');
            await page.click('.preview_wrap.name .yeyakSearchName');
            await page.waitForSelector('#srch_rcfcl ul li a', { visible: true });
            
            // '소백산자연휴양림' 찾기
            const facilityLinks = await page.$$('#srch_rcfcl ul li a');
            let targetFacilityLink = null;
            for (const link of facilityLinks) {
                if ((await link.evaluate(el => el.textContent)).includes('(단양군)소백산자연휴양림')) {
                    targetFacilityLink = link;
                    break;
                }
            }

            if (targetFacilityLink) {
                // 새 탭 열림 감지 (달력 페이지)
                const pagesBefore = await browser.pages();
                await targetFacilityLink.click();
                await new Promise(r => setTimeout(r, 3000));
                const pagesAfter = await browser.pages();
                let calendarPage = pagesAfter.length > pagesBefore.length ? pagesAfter[pagesAfter.length - 1] : page;
                if (calendarPage !== page) await calendarPage.bringToFront();

                // --- [3. 날짜 선택] ---
                console.log('📅 날짜 선택 중...');
                await calendarPage.click('#calPicker');
                await calendarPage.waitForSelector('.cal_left', { visible: true });

                // ⭐️ 예약 날짜 설정
                const checkIn = '5';
                const checkOut = '6';

                // 입실일 클릭
                const dayLinks = await calendarPage.$$('tbody a[data-date]');
                for (const link of dayLinks) {
                    if (await link.evaluate(el => el.textContent.trim()) === checkIn) {
                        await link.click();
                        break;
                    }
                }
                // 퇴실일 클릭
                const outLinks = await calendarPage.$$('tbody a[data-date]');
                for (const link of outLinks) {
                    if (await link.evaluate(el => el.textContent.trim()) === checkOut) {
                        await link.click();
                        break;
                    }
                }

                // 날짜 선택 완료 버튼 클릭
                await calendarPage.click('.defBtn.board'); 
                await calendarPage.waitForSelector('.cal_left', { hidden: true });
                
                // 최종 조회 버튼 클릭
                await Promise.all([
                    calendarPage.waitForNavigation({ waitUntil: 'networkidle0' }),
                    calendarPage.click('.s_2_btn button[title="조회하기"]')
                ]);

                // --- [4. 방 찾기 및 예약 클릭] ---
                console.log('🔍 "중선암" 방 찾는 중...');
                
                // 팝업창(Alert) 자동 수락 설정
                calendarPage.on('dialog', async dialog => await dialog.accept());
                
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
                            // 버튼이 실제로 화면에 보이는지(예약가능 상태인지) 확인
                            const status = await calendarPage.evaluate(anchor => {
                                const span = anchor.querySelector('.txtRsrvt');
                                return (span && window.getComputedStyle(span).display !== 'none') ? 'GO' : 'STOP';
                            }, btn);

                            if (status === 'GO') {
                                console.log('✨ 예약 가능! 버튼 클릭!');
                                await calendarPage.evaluate(el => el.click(), btn); // 강제 클릭
                                isBooked = true;
                                break;
                            }
                        }
                    }
                }

                if (isBooked) {
                    // ============================================================
                    // ⭐️ Step 7: [완전 자동화] 약관 동의 + OCR 보안문자 해결
                    // ============================================================
                    console.log('--- Step 7: 약관 동의 및 OCR 보안문자 풀기 ---');
                    
                    // 1. 레이어 팝업(예약정보창) 대기
                    await new Promise(r => setTimeout(r, 2000));

                    // 2. 약관 동의 (#arr_01)
                    try {
                        await calendarPage.waitForSelector('#arr_01', { timeout: 5000 });
                        const agreeCheckbox = await calendarPage.$('#arr_01');
                        if (agreeCheckbox) {
                            const isChecked = await calendarPage.evaluate(el => el.checked, agreeCheckbox);
                            if (!isChecked) {
                                await calendarPage.evaluate(el => el.click(), agreeCheckbox);
                                console.log('✅ 이용약관(#arr_01) 동의 완료');
                            }
                        }
                    } catch (e) {
                        console.warn('약관 체크박스를 찾지 못했습니다.');
                    }

                    // 3. 보안문자 이미지(#captchaImg) 캡처
                    const captchaImg = await calendarPage.$('#captchaImg');
                    if (captchaImg) {
                        console.log('📸 보안문자 캡처 중...');
                        // 이미지만 잘라서 'captcha_target.png'로 저장
                        await captchaImg.screenshot({ path: 'captcha_target.png' });
                        
                        // 4. Python OCR 실행 (ocr_solver.py 호출)
                        console.log('🐍 Python OCR 수행 중...');
                        try {
                            // 터미널 명령어로 파이썬 실행 -> 결과를 변수에 저장
                            const captchaResult = execSync('python ocr_solver.py captcha_target.png').toString().trim();
                            
                            console.log(`👉 OCR 판독 결과: [${captchaResult}]`);

                            if (captchaResult && captchaResult.length >= 4) {
                                // 5. 결과 입력 (#atmtcRsrvtPrvntChrct)
                                await calendarPage.type('#atmtcRsrvtPrvntChrct', captchaResult);
                                console.log('⌨️ 보안문자 입력 완료!');

                                // 6. 최종 예약 버튼 클릭 (#btnRsrvt)
                                console.log('🚀 [최종] 예약 버튼(#btnRsrvt)을 누릅니다...');
                                await new Promise(r => setTimeout(r, 500)); // 잠시 대기
                                await calendarPage.click('#btnRsrvt');
                                
                                console.log('🎉🎉🎉 예약 요청 완료! 브라우저에서 결과를 확인하세요. 🎉🎉🎉');
                            } else {
                                console.warn('⚠️ OCR 인식 실패 또는 결과가 너무 짧습니다. 수동 입력을 대기합니다.');
                            }

                        } catch (pyError) {
                            console.error('Python 실행 중 오류:', pyError);
                        }

                    } else {
                        console.warn('보안문자 이미지를 찾지 못했습니다.');
                    }

                    // 브라우저 꺼짐 방지 (결과 확인용)
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