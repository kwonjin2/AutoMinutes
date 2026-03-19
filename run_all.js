const { execSync } = require('child_process');

console.log("=========================================");
console.log("🚀 Node.js 기반 회의록 AI 파이프라인 시작");
console.log("=========================================\n");

try {
    console.log("[1/5] 오디오 전사 실행 중...");
    execSync('npm run transcribe', { stdio: 'inherit' });

    console.log("\n[2/5] 전사록 요약 생성 및 파일 최적화 중...");
    execSync('npm run summarize', { stdio: 'inherit' });

    console.log("\n[3/5] Discord 업로드 실행...");
    execSync('npm run discord', { stdio: 'inherit' });

    console.log("\n[4/5] Notion 업로드 실행...");
    execSync('npm run notion', { stdio: 'inherit' });

    console.log("\n[5/5] GitHub Wiki 업데이트 실행...");
    execSync('npm run wiki', { stdio: 'inherit' });

    console.log("\n🎯 모든 파이프라인이 성공적으로 완료되었습니다!");
    console.log("   (테스트 모드일 경우 실제 업로드는 수행되지 않았습니다.)");
} catch (error) {
    console.error(`❌ 파이프라인 실행 중 오류가 발생했습니다:`, error.message);
}
