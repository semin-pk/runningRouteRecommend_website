import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

function useKakaoLoader() {
	const [loaded, setLoaded] = useState(false)
	const [error, setError] = useState(null)
	useEffect(() => {
		console.log('KAKAO_JS_KEY:', KAKAO_JS_KEY)
		if (window.kakao && window.kakao.maps) {
			console.log('Kakao already loaded')
			setLoaded(true)
			return
		}
		if (!KAKAO_JS_KEY) {
			console.error('KAKAO_JS_KEY is not set')
			setError('KAKAO_JS_KEY is not set')
			return
		}
		const script = document.createElement('script')
		script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}`
		script.async = true
		script.onload = () => {
			console.log('Kakao script loaded')
			setLoaded(true)
		}
		script.onerror = (e) => {
			console.error('Failed to load Kakao script:', e)
			setError('Failed to load Kakao Maps')
		}
		document.head.appendChild(script)
		return () => {
			if (document.head.contains(script)) {
				document.head.removeChild(script)
			}
		}
	}, [])
	return { loaded, error }
}

function MapPicker({ onPick }) {
	const ref = useRef(null)
	const [coords, setCoords] = useState(null)
	const { loaded, error } = useKakaoLoader()

	useEffect(() => {
		if (!loaded || !ref.current) return
		const kakao = window.kakao
		const map = new kakao.maps.Map(ref.current, {
			center: new kakao.maps.LatLng(37.5665, 126.978),
			level: 5,
		})
		const marker = new kakao.maps.Marker({ position: map.getCenter() })
		marker.setMap(map)
		kakao.maps.event.addListener(map, 'click', function (mouseEvent) {
			const latlng = mouseEvent.latLng
			marker.setPosition(latlng)
			const lat = latlng.getLat()
			const lng = latlng.getLng()
			setCoords({ lat, lng })
			onPick(lat, lng)
		})
	}, [loaded, onPick])

	if (error) {
		return (
			<div>
				<div style={{ width: '100%', height: 360, borderRadius: 8, border: '1px solid #ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' }}>
					<div style={{ textAlign: 'center', color: '#666' }}>
						<div>❌ {error}</div>
						<div style={{ fontSize: 12, marginTop: 8 }}>카카오 지도 API 키를 확인해주세요</div>
					</div>
				</div>
			</div>
		)
	}

	if (!loaded) {
		return (
			<div>
				<div style={{ width: '100%', height: 360, borderRadius: 8, border: '1px solid #ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' }}>
					<div style={{ textAlign: 'center', color: '#666' }}>
						<div>🔄 카카오 지도 로딩 중...</div>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div>
			<div ref={ref} style={{ width: '100%', height: 360, borderRadius: 8, border: '1px solid #ddd' }} />
			<div style={{ marginTop: 8, fontSize: 14 }}>
				{coords ? `선택 위치: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : '지도를 클릭하여 시작 위치를 선택하세요'}
			</div>
		</div>
	)
}

export default function App() {
	const [lat, setLat] = useState(null)
	const [lng, setLng] = useState(null)
	const [distanceKm, setDistanceKm] = useState(5)
	const [theme, setTheme] = useState('카페')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState(null)
	const [error, setError] = useState(null)

	const canSubmit = lat !== null && lng !== null && distanceKm > 0 && theme.trim().length > 0

	const onPick = useCallback((la, ln) => {
		setLat(la)
		setLng(ln)
	}, [])

	const submit = async () => {
		if (!canSubmit || !BACKEND_URL) return
		setLoading(true)
		setError(null)
		setResult(null)
		try {
			const r = await fetch(`${BACKEND_URL}/api/recommend`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ start_lat: lat, start_lng: lng, distance_km: distanceKm, theme_keyword: theme }),
			})
			if (!r.ok) throw new Error(await r.text())
			const data = await r.json()
			setResult(data)
		} catch (e) {
			const errorText = await e.text ? await e.text() : String(e)
			if (errorText.includes('OPEN_MAP_AND_LOCAL')) {
				setError('Kakao Local API가 활성화되지 않았습니다. 카카오 개발자 콘솔에서 "OPEN_MAP_AND_LOCAL" 서비스를 활성화해주세요.')
			} else {
				setError(errorText)
			}
		} finally {
			setLoading(false)
		}
	}

	return (
		<div style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
			<h2>러닝 코스 랜덤 추천</h2>
			<MapPicker onPick={onPick} />
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
				<div>
					<label>러닝 거리 (km)</label>
					<input type="number" value={distanceKm} min={0.5} step={0.5} onChange={(e) => setDistanceKm(Number(e.target.value))} style={{ width: '100%' }} />
				</div>
				<div>
					<label>테마</label>
					<input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="맥주 / 카페 / 맛집" style={{ width: '100%' }} />
				</div>
				<div style={{ alignSelf: 'end' }}>
					<button disabled={!canSubmit || loading} onClick={submit} style={{ width: '100%' }}>
						{loading ? '추천중...' : '추천 받기'}
					</button>
				</div>
			</div>

			{error && <div style={{ color: 'crimson', marginTop: 12 }}>{error}</div>}

			{result && (
				<div style={{ marginTop: 16 }}>
					<div style={{ marginBottom: 8 }}>
						추천 장소: {result.selected_place?.place_name ?? '없음'}
						{result.candidates_considered === 0 && (
							<div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
								해당 지역에서 '{theme}' 테마의 장소를 찾을 수 없습니다.
							</div>
						)}
					</div>
					<a href={result.route_url} target="_blank" rel="noreferrer">
						걷기 길찾기 열기
					</a>
				</div>
			)}
		</div>
	)
}
