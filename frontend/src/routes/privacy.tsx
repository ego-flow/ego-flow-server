import { createFileRoute } from "@tanstack/react-router";

const CONTACT_EMAIL = "egoflow3@gmail.com";
const EFFECTIVE_DATE = "2026-07-09";

const sections = [
	{
		title: "1. 처리하는 개인정보 항목",
		body: [
			"EgoFlow는 서비스 제공에 필요한 범위에서 계정 식별 정보, 로그인 인증 정보, 접속 토큰 및 세션 정보를 처리합니다.",
			"사용자가 라이브 스트리밍, 녹화, 사진 캡처 기능을 사용할 때 Meta AI 안경 또는 휴대폰 카메라의 영상 데이터, 선택적으로 활성화한 마이크 또는 Bluetooth 오디오 데이터, 저장된 영상 파일과 썸네일을 처리할 수 있습니다.",
			"저장소 선택 정보, 녹화 세션 ID, 스트림 상태, 업로드 청크, 생성 및 수정 시각, 접근 권한 정보, 서비스 운영 로그와 같은 사용 기록 및 기기/네트워크 상태 정보가 처리될 수 있습니다.",
		],
	},
	{
		title: "2. 개인정보의 처리 목적",
		body: [
			"계정 인증, 사용자의 저장소 접근 권한 확인, 라이브 스트림 등록 및 송출, 녹화 영상 저장과 재생, 썸네일 제공, 서비스 장애 분석, 보안 유지, 부정 이용 방지를 위해 개인정보를 처리합니다.",
			"카메라와 마이크 데이터는 사용자가 선택한 스트리밍 또는 녹화 기능을 제공하기 위한 목적으로만 사용됩니다.",
		],
	},
	{
		title: "3. 개인정보의 보관 및 삭제",
		body: [
			"계정 및 인증 정보는 서비스 이용 기간 동안 보관되며, 법령상 보관 의무 또는 분쟁 대응 필요가 없는 경우 삭제 요청 또는 계정 정리 절차에 따라 삭제됩니다.",
			"녹화 영상, 썸네일, 저장소 및 세션 메타데이터는 사용자가 선택한 저장소 기능을 제공하기 위해 보관되며, 사용자가 서비스에서 허용하는 삭제 기능을 사용하거나 운영자에게 삭제를 요청할 수 있습니다.",
			"운영 로그는 보안, 장애 대응, 서비스 품질 개선에 필요한 기간 동안 제한적으로 보관됩니다.",
		],
	},
	{
		title: "4. 개인정보의 제3자 제공 및 처리위탁",
		body: [
			"EgoFlow는 사용자의 개인정보를 판매하지 않습니다.",
			"서비스 운영을 위해 EgoFlow 백엔드, 저장소 인프라, 네트워크 프록시, Meta Wearables Device Access Toolkit 및 기기 운영체제 기능과 같이 앱 기능 제공에 필요한 시스템에서 데이터가 처리될 수 있습니다.",
			"법령에 따른 요청이 있거나 사용자의 명시적 동의가 있는 경우를 제외하고 개인정보를 목적 외로 제3자에게 제공하지 않습니다.",
		],
	},
	{
		title: "5. 민감한 사용자 및 기기 데이터",
		body: [
			"카메라, 마이크, Bluetooth, 네트워크 상태, 포그라운드 서비스 권한은 사용자가 요청한 안경 연결, 휴대폰 카메라 대체 입력, 라이브 스트리밍, 녹화, 오디오 송출 기능을 제공하기 위해 사용됩니다.",
			"사용자는 앱 권한 설정에서 카메라, 마이크, Bluetooth 권한을 관리할 수 있으며, 오디오 송출 기능은 앱 설정에서 비활성화할 수 있습니다.",
		],
	},
	{
		title: "6. 이용자의 권리와 문의",
		body: [
			"사용자는 개인정보 열람, 정정, 삭제, 처리 정지와 관련한 문의를 할 수 있습니다.",
			`개인정보 관련 요청은 ${CONTACT_EMAIL} 으로 문의해 주시기 바랍니다.`,
		],
	},
	{
		title: "7. 개인정보처리방침의 변경",
		body: [
			"본 개인정보처리방침은 서비스 기능, 운영 방식, 법령 또는 정책 변경에 따라 업데이트될 수 있습니다.",
			"중요한 변경 사항이 있는 경우 서비스 화면 또는 별도 공지를 통해 안내합니다.",
		],
	},
];

export const Route = createFileRoute("/privacy")({
	head: () => ({
		meta: [
			{
				title: "개인정보처리방침 | EgoFlow",
			},
			{
				name: "description",
				content:
					"EgoFlow Android 앱과 서버가 민감한 사용자 및 기기 데이터를 어떻게 처리하는지 설명하는 개인정보처리방침입니다.",
			},
		],
	}),
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<main className="page-wrap min-h-[calc(100dvh-5rem)] px-4 py-10 sm:px-6 sm:py-14 lg:py-16">
			<section className="island-shell mx-auto w-full max-w-4xl rounded-2xl p-6 shadow-xl sm:p-8 lg:p-10">
				<p className="island-kicker mb-3">EgoFlow</p>
				<h1 className="display-title text-balance text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
					개인정보처리방침
				</h1>
				<p className="mt-4 text-sm leading-relaxed text-[var(--sea-ink-soft)] sm:text-base">
					EgoFlow는 사용자의 개인정보와 민감한 기기 데이터를 투명하고 안전하게
					처리하기 위해 아래와 같이 개인정보처리방침을 공개합니다.
				</p>
				<dl className="mt-6 grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-4 text-sm text-[var(--sea-ink-soft)] sm:grid-cols-2">
					<div>
						<dt className="font-semibold text-[var(--sea-ink)]">시행일</dt>
						<dd className="mt-1">{EFFECTIVE_DATE}</dd>
					</div>
					<div>
						<dt className="font-semibold text-[var(--sea-ink)]">문의</dt>
						<dd className="mt-1">
							<a
								href={`mailto:${CONTACT_EMAIL}`}
								className="font-medium text-[var(--lagoon-deep)] underline-offset-4 hover:underline"
							>
								{CONTACT_EMAIL}
							</a>
						</dd>
					</div>
				</dl>

				<div className="mt-8 space-y-8">
					{sections.map((section) => (
						<section key={section.title}>
							<h2 className="text-xl font-bold text-[var(--sea-ink)]">
								{section.title}
							</h2>
							<div className="mt-3 space-y-3 text-sm leading-7 text-[var(--sea-ink-soft)] sm:text-base">
								{section.body.map((paragraph) => (
									<p key={paragraph}>{paragraph}</p>
								))}
							</div>
						</section>
					))}
				</div>
			</section>
		</main>
	);
}
