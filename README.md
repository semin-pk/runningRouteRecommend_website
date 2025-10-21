# 러닝 코스 랜덤 추천 웹사이트

FastAPI + React로 구축된 러닝 코스 추천 서비스입니다.

## 기능

- 카카오 지도에서 클릭하여 러닝 시작 위치 설정
- 러닝 거리 설정 (km)
- 테마 설정 (맥주, 카페, 맛집 등)
- 카카오 Local API를 통한 장소 검색 및 랜덤 추천
- 카카오 지도 걷기 길찾기 URL 생성

## 설정 방법

### 1. 카카오 API 키 설정

**중요**: 현재 "OPEN_MAP_AND_LOCAL service disabled" 오류가 발생하는 경우, 다음 단계를 따라주세요:

1. [카카오 개발자 콘솔](https://developers.kakao.com/)에 로그인
2. 애플리케이션 선택
3. "제품 설정" → "카카오 로그인" → "동의항목" 메뉴로 이동
4. "OPEN_MAP_AND_LOCAL" 서비스 활성화
5. 또는 "제품 설정" → "카카오맵" → "Web" → "Local API" 활성화

### 2. 환경 변수 설정

#### Backend (.env 또는 환경변수)
```bash
KAKAO_REST_API_KEY=your_kakao_rest_api_key_here
```

#### Frontend (frontend/.env.local)
```
VITE_KAKAO_JS_KEY=your_kakao_javascript_key_here
VITE_BACKEND_URL=http://localhost:8000
```

### 3. 실행 방법

#### Backend 실행
```bash
# 가상환경 활성화
.venv\Scripts\activate

# 환경변수 설정 (Windows PowerShell)
$env:KAKAO_REST_API_KEY="your_kakao_rest_api_key"

# 서버 실행
.venv\Scripts\uvicorn.exe backend.main:app --host 0.0.0.0 --port 8000
```

#### Frontend 실행
```bash
cd frontend
npm install
npm run dev
```

## API 엔드포인트

- `GET /health` - 서버 상태 확인
- `POST /api/recommend` - 러닝 코스 추천

### 추천 요청 예시
```json
{
  "start_lat": 37.5665,
  "start_lng": 126.9780,
  "distance_km": 5.0,
  "theme_keyword": "카페"
}
```

## 문제 해결

### "OPEN_MAP_AND_LOCAL service disabled" 오류
- 카카오 개발자 콘솔에서 Local API 서비스를 활성화해야 합니다
- 현재는 기본적인 지도 표시만 가능하며, 장소 검색 기능은 제한됩니다

### 카카오 지도가 로드되지 않는 경우
- `VITE_KAKAO_JS_KEY`가 올바르게 설정되었는지 확인
- 브라우저 개발자 도구에서 네트워크 오류 확인

## 기술 스택

- **Backend**: FastAPI, httpx, pydantic
- **Frontend**: React, Vite
- **지도**: Kakao Maps API
- **검색**: Kakao Local API
