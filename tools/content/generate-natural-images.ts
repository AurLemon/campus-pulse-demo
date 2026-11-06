/** Offline, resumable image library generation. No business records are changed.
 * HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 NODE_USE_ENV_PROXY=1 node tools/content/generate-natural-images.ts --limit=8
 * After visually checking the first contact sheet, expand with --limit=48 --provider=junlin.
 * --review-samples makes only four isolated pending style samples, with fresh exact-model pricing and no publication.
 * --retry-failed permits one explicit retry of an existing failed scene, never an automatic loop.
 * --review-only --review-file=/absolute/reviews.json --pack publishes reviewed images atomically.
 * Review JSON maps image IDs to { status: 'approved' | 'rejected', facts: string[], note?: string }.
 * Reservations, failed calls and model stop reasons persist under .data/image-generation.
 * GPT total includes the prior approved sample. Accounting is conservative quotation, not actual debits.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
	mkdir,
	readFile,
	writeFile,
	rename,
	copyFile,
	stat,
} from 'node:fs/promises'
import { resolve, join } from 'node:path'
import lockfile from 'proper-lockfile'
import sharp from 'sharp'
import { runImageBatch } from './image-batch.ts'
import {
	ensureAssetCache,
	writeAssetCacheFile,
	packAssetCache,
} from './asset-bundle.ts'

interface Scene {
	id: string
	subject: string
	facts: string[]
	topics: string[]
	kind: 'photo' | 'sticker'
	provider: 'junlin' | 'volcengine'
}
interface Entry {
	id: string
	sceneId: string
	provider: string
	status: 'reserved' | 'generated' | 'failed'
	reservedUsd: number
	at: string
	requestId?: string
	error?: string
	usage?: unknown
}
interface Ledger {
	version: 1
	limits: Record<string, number>
	entries: Entry[]
	accounting: string
	stoppedProviders?: Record<string, string>
	unlimitedProviders?: Record<string, boolean>
}
interface ImageFact {
	id: string
	provider: string
	model: string
	kind: string
	file: string
	mediaPath: string
	stagedPath: string
	url: string
	sha256: string
	width: number
	height: number
	topics: string[]
	plannedFacts: string[]
	verifiedFacts: string[]
	review: { status: 'pending' | 'approved' | 'rejected'; note?: string }
	prompt: string
}
const definitions: Array<[string, string, string[], string[]]> = [
	[
		'dorm-noodles',
		'桌上泡面杯里只有清水和面条，未拆开的调料袋放在旁边，宿舍书桌杂物正常',
		['泡面杯', '清水面条', '旁边未拆调料袋'],
		['food', 'daily'],
	],
	[
		'canteen-tray',
		'普通学生食堂桌上不锈钢餐盘，米饭、青菜和炒鸡蛋，餐具摆得随意',
		['不锈钢餐盘', '米饭', '青菜', '炒鸡蛋'],
		['food', 'daily'],
	],
	[
		'running-shoes',
		'夜跑结束的塑胶跑道边，两只旧运动鞋和水瓶，不出现人脸',
		['塑胶跑道', '运动鞋', '水瓶'],
		['sports'],
	],
	[
		'basketball-rest',
		'普通室外篮球场边水泥地上一颗用旧的篮球，背景是篮架',
		['篮球', '篮球架', '室外球场'],
		['sports'],
	],
	[
		'guitar-desk',
		'一把木吉他靠着普通宿舍椅子，座位上有拨片与调音夹',
		['木吉他', '椅子', '拨片'],
		['music', 'daily'],
	],
	[
		'library-books',
		'图书馆普通木桌上几本没有可读书名的书，笔记本和水杯，略拥挤',
		['书籍', '木桌', '笔记本', '水杯'],
		['reading', 'learning'],
	],
	[
		'study-desk',
		'晚间普通书桌，一盏台灯，摊开的无字草稿本和几支笔，一小堆橡皮屑，非精致摆拍',
		['台灯', '草稿本', '笔', '橡皮屑'],
		['learning', 'daily'],
	],
	[
		'camera-strap',
		'相机和相机背带随手放在室外长椅上，一点树叶阴影',
		['相机', '背带', '长椅', '树影'],
		['photography'],
	],
	[
		'cat-bench',
		'普通橘猫缩在木长椅下，午后散射光，地面有两片落叶',
		['橘猫', '长椅下方', '落叶'],
		['daily', 'photography'],
	],
	[
		'club-table',
		'社团活动准备桌上有彩色便签、胶带、剪刀和空白纸张，不出现可读横幅',
		['便签', '胶带', '剪刀', '纸张'],
		['volunteer', 'daily'],
	],
	[
		'breakfast-soy',
		'食堂早餐窗口旁的桌上豆浆纸杯和两个普通包子，杯子无标识',
		['纸杯', '包子', '早餐桌'],
		['food'],
	],
	[
		'laundry-balcony',
		'普通学生宿舍生活阳台，晾着几件T恤和毛巾，不见人脸，无可辨认校园标识',
		['晾衣架', 'T恤', '毛巾'],
		['daily'],
	],
	[
		'badminton-bag',
		'体育馆木地板边放着两支羽毛球拍、羽毛球和打开的球包',
		['羽毛球拍', '羽毛球', '球包', '木地板'],
		['sports'],
	],
	[
		'keyboard-practice',
		'练习室一角的电子琴局部和空白谱纸，琴凳上放着水瓶，没有人脸',
		['电子琴', '谱纸', '琴凳', '水瓶'],
		['music'],
	],
	[
		'rain-umbrella',
		'雨后普通教学楼门口地面一把合起的伞和浅水洼，仅通用建筑局部',
		['雨伞', '水洼', '雨后地面'],
		['daily', 'photography'],
	],
	[
		'secondhand-books',
		'一小摞旧书放在帆布袋旁，封面无清晰文字，书页略卷',
		['旧书', '帆布袋', '卷边书页'],
		['reading', 'volunteer'],
	],
	[
		'group-study',
		'四个人一起学习后的桌面，只有手臂局部，草稿纸、不同颜色的笔和水杯，没有人物正脸',
		['多人桌面', '草稿纸', '笔', '水杯'],
		['learning'],
	],
	[
		'coffee-notes',
		'普通纸杯咖啡在笔记本旁，杯壁有一点水渍，桌面有随手放的钥匙',
		['纸杯咖啡', '笔记本', '钥匙'],
		['food', 'learning'],
	],
	[
		'table-tennis',
		'室内乒乓球桌一角，两只球拍和一颗乒乓球，普通运动场馆灯光',
		['乒乓球桌', '两只球拍', '乒乓球'],
		['sports'],
	],
	[
		'mic-rehearsal',
		'空的普通排练室，话筒架和一根卷得不太齐的线，背景一把折叠椅',
		['话筒架', '线缆', '折叠椅'],
		['music'],
	],
	[
		'sunset-window',
		'普通宿舍窗框的一角，窗外暖色傍晚天空，前景有晾衣夹，没有地标',
		['窗框', '傍晚天空', '晾衣夹'],
		['daily', 'photography'],
	],
	[
		'bicycle-lock',
		'普通自行车停在树边，车篮里放着一把链条锁，画面轻微倾斜',
		['自行车', '车篮', '链条锁'],
		['daily', 'sports'],
	],
	[
		'late-snack',
		'晚上普通书桌上一个装着几块饼干的小盘和温水杯，无品牌包装',
		['饼干', '小盘', '水杯'],
		['food', 'daily'],
	],
	[
		'lab-components',
		'普通学生实验桌上面包板、电阻和跳线，无发光夸张特效，不出现屏幕和终端',
		['面包板', '电阻', '跳线'],
		['technology', 'learning'],
	],
	[
		'charging-cables',
		'宿舍书桌上绕在一起的充电线和充电头，背景一本合上的书，插座不通电',
		['充电线', '充电头', '书'],
		['technology', 'daily'],
	],
	[
		'chess-club',
		'桌上普通棋盘和散乱棋子，两把空椅子，学生公共活动空间，不要求特定棋局',
		['棋盘', '棋子', '空椅子'],
		['daily'],
	],
	[
		'bookmarks',
		'摊开的无可读文字书页间夹着两张自制纯色书签，旁边一支铅笔',
		['书页', '两张书签', '铅笔'],
		['reading'],
	],
	[
		'sports-towel',
		'运动场边长椅上放着毛巾、水瓶和一条普通运动护腕',
		['长椅', '毛巾', '水瓶', '护腕'],
		['sports'],
	],
	[
		'guitar-strings',
		'学生木吉他练习后桌面，拆开的琴弦袋和几根更换下来的卷曲旧琴弦，不可读品牌',
		['琴弦袋', '卷曲琴弦', '桌面'],
		['music'],
	],
	[
		'camera-leaves',
		'从随手举起的手机视角拍到石板地上的落叶和路边树影，阴天真实质感',
		['落叶', '石板地', '树影'],
		['photography'],
	],
	[
		'volunteer-gloves',
		'志愿活动准备桌上几双干净劳保手套、垃圾夹和折起的垃圾袋，无活动口号',
		['劳保手套', '垃圾夹', '垃圾袋'],
		['volunteer'],
	],
	[
		'canteen-soup',
		'普通食堂桌上有小碗清汤和餐盘一角，汤里有几片紫菜和葱花，环境普通',
		['汤碗', '紫菜', '葱花', '餐盘'],
		['food'],
	],
	[
		'dorm-slippers',
		'宿舍床边地面上一双歪放的拖鞋，书包靠在椅子上，画面日常但干净',
		['拖鞋', '书包', '椅子'],
		['daily'],
	],
	[
		'reading-corner',
		'公共阅读角普通椅子上放着一本打开的书和帆布袋，窗边自然光',
		['椅子', '打开的书', '帆布袋'],
		['reading'],
	],
	[
		'messy-scratch',
		'桌上几张写着不清晰铅笔符号的草稿纸，橡皮、尺子和半支削下来的木屑，勿生成代码',
		['草稿纸', '橡皮', '尺子', '铅笔屑'],
		['learning'],
	],
	[
		'cat-stairs',
		'一只灰白猫坐在普通室外台阶边，旁边一片绿叶，阴天手机随拍',
		['灰白猫', '台阶', '绿叶'],
		['daily', 'photography'],
	],
	[
		'badminton-broken',
		'一颗羽毛有点炸开的旧羽毛球放在球拍线上，体育馆地板背景',
		['旧羽毛球', '球拍线', '木地板'],
		['sports'],
	],
	[
		'music-capo',
		'木吉他琴颈局部，变调夹夹在琴颈上，普通练习环境，非商业特写',
		['吉他琴颈', '变调夹'],
		['music'],
	],
	[
		'study-cushion',
		'自习座位边一个普通靠垫和帆布袋，桌上合着笔记本，桌面稍杂乱',
		['靠垫', '帆布袋', '笔记本'],
		['learning', 'daily'],
	],
	[
		'dorm-banana',
		'宿舍桌上一个小碗、两根香蕉和一包未拆饼干，包装没有可读品牌',
		['小碗', '两根香蕉', '未拆饼干'],
		['food', 'daily'],
	],
	[
		'club-scissors',
		'活动结束后桌上零碎彩纸、胶带和剪刀，稍凌乱但无垃圾堆，不出现文字',
		['彩纸', '胶带', '剪刀'],
		['volunteer', 'daily'],
	],
	[
		'camera-rain',
		'雨后相机包放在长椅上，背景湿润地面和一片模糊绿植',
		['相机包', '长椅', '湿地面', '绿植'],
		['photography'],
	],
	[
		'books-return',
		'普通图书归还收集桌上几本竖放和横放的书，无明确图书馆名称，无可读书名',
		['书籍', '收集桌'],
		['reading', 'volunteer'],
	],
	[
		'running-track-dusk',
		'傍晚普通塑胶跑道一角，没有人物，内侧草地有落下的小叶子，无特定校园建筑',
		['塑胶跑道', '草地', '落叶', '傍晚'],
		['sports', 'photography'],
	],
	[
		'sticker-sleepy',
		'原创极简手绘圆滚滚米白猫趴在一本合上的书上，困到眼睛成为两条线，无文字，无知名角色，白色背景',
		['米白猫插画', '合上的书', '困倦表情'],
		['daily', 'reading'],
	],
	[
		'sticker-confused',
		'原创极简手绘灰白小猫歪头看一支铅笔，三根短线表达疑惑，无文字无问号，白色背景',
		['灰白猫插画', '铅笔', '歪头'],
		['learning', 'daily'],
	],
	[
		'sticker-cheer',
		'原创极简手绘圆润小橘猫举起两只爪子，旁边两个小星星，安静可爱，无文字无知名角色，白色背景',
		['橘猫插画', '举爪', '小星星'],
		['daily', 'sports'],
	],
	[
		'sticker-empty-bowl',
		'原创极简手绘小白猫坐在一个空碗旁边，望着碗，一脸等饭，无文字，白色背景',
		['白猫插画', '空碗', '等待表情'],
		['food', 'daily'],
	],
]
const scenes: Scene[] = definitions.map(
	([slug, subject, facts, topics], index) => ({
		id: `natural-${String(index + 1).padStart(2, '0')}-${slug}`,
		subject,
		facts,
		topics,
		kind: slug.startsWith('sticker-') ? 'sticker' : 'photo',
		provider: index < 28 || index >= 44 ? 'junlin' : 'volcengine',
	}),
)
const root = resolve('.data/image-generation'),
	ledgerPath = join(root, 'natural-image-ledger.json')
const argv = process.argv.slice(2)
const value = (name: string, fallback: string) =>
	argv.find((arg) => arg.startsWith(name + '='))?.slice(name.length + 1) ??
	fallback
const limit = Number(value('--limit', '8'))
const providerFilter = value('--provider', 'all')
const reviewPath = value('--review-file', '')
const reviewSamples = argv.includes('--review-samples')
const batchPlanPath = value('--batch-plan', '')
if (batchPlanPath || argv.includes('--authorize-image-unlimited')) {
	await runImageBatch({
		planPath: batchPlanPath || undefined,
		limit,
		concurrency: Number(value('--concurrency', '4')),
		authorizeUnlimited: argv.includes('--authorize-image-unlimited'),
	})
	process.exit(0)
}
const sampleDirectory = join(root, 'style-review-v2')
const reserveUsd = 0.12
if (
	reviewSamples &&
	(argv.includes('--pack') || reviewPath || argv.includes('--retry-failed'))
)
	throw Error('SAMPLES_CANNOT_PUBLISH_OR_RETRY')
if (reviewSamples)
	await mkdir(sampleDirectory, { recursive: true, mode: 0o700 })
const sampleDefinitions = [
	[
		'spill',
		'大学宿舍一次倒霉的小意外，桌上一个普通透明水杯刚倒了，少量水洒在外接键盘旁的桌面，键盘只拍到一半且不是主角，一团用过的纸巾正在吸水，插线没有泡水，没有人物和手，日常廉价书桌，桌角有饭卡背面和乱绕的数据线，随便歪着举手机从上方抓拍，边缘裁掉杯子的一点，室内顶灯混合窗光，整体略暗，轻微手抖和手机压缩，普通不漂亮的小失误',
		['倒下的水杯', '桌面少量积水', '纸巾', '键盘局部'],
		['daily', 'technology'],
	],
	[
		'meal',
		'普通学生食堂吃到一半才想起来拿手机拍一张，不锈钢分格餐盘里剩一半米饭，一点炒青菜和鸡蛋，饭菜已经动过，筷子横着随便搭在边上，勺子里一点残余菜汁，普通廉价灰白食堂桌，镜头歪十度，从座位上斜着随手一拍，餐盘靠近镜头的边缘被切掉，不是整齐居中构图，没有额外摆拍道具，白色顶灯偏冷，轻微手机噪点和模糊，普通到不值得专门拍照的午饭，不加美食滤镜不突出油亮色泽',
		['吃到一半的米饭', '青菜', '鸡蛋', '餐盘和筷子'],
		['daily', 'food'],
	],
] as const
const sampleScenes: Scene[] = sampleDefinitions.flatMap(
	([id, subject, facts, topics]) =>
		(['junlin', 'volcengine'] as const).map((provider) => ({
			id: `style-review-v2-${id}-${provider}`,
			subject,
			facts: [...facts],
			topics: [...topics],
			kind: 'photo' as const,
			provider,
		})),
)
const pricingSources = {
	junlin: 'https://api-hub.asia/api/v1/model-plaza',
	volcengine:
		'https://docs.volcengine.com/docs/ark/model-pricing?lang=en&redirect=1',
}
await mkdir(root, { recursive: true, mode: 0o700 })
try {
	await writeFile(
		ledgerPath,
		JSON.stringify({
			version: 1,
			limits: { junlin: 5, volcengine: 5 },
			accounting:
				'Conservative estimates, not provider debits. GPT highest advertised image channel price $0.12. Volcengine flash CNY0.12, conservatively reserve USD0.12 without claiming exchange-rate billing.',
			entries: [
				{
					id: 'approved-style-sample-2026-11-06',
					sceneId: 'style-sample',
					provider: 'junlin',
					status: 'generated',
					reservedUsd: 0.12,
					at: '2026-11-05T20:30:28.672Z',
				},
			],
		} satisfies Ledger),
		{ flag: 'wx', mode: 0o600 },
	)
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
}
async function ledgerTask<T>(task: (ledger: Ledger) => T): Promise<T> {
	const release = await lockfile.lock(ledgerPath, {
		retries: { retries: 40, minTimeout: 100, maxTimeout: 400 },
		stale: 30000,
	})
	try {
		const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as Ledger
		const result = task(ledger)
		const temp = `${ledgerPath}.${randomUUID()}.tmp`
		await writeFile(temp, JSON.stringify(ledger, null, '\t') + '\n', {
			mode: 0o600,
		})
		await rename(temp, ledgerPath)
		return result
	} finally {
		await release()
	}
}
try {
	await copyFile(
		resolve('tools/content/assets.tar.gz'),
		join(root, 'assets-before-natural.tar.gz'),
		1,
	)
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
}
const directory = await ensureAssetCache()
const factsPath = reviewSamples
	? join(sampleDirectory, 'facts.json')
	: join(directory, 'natural-image-facts.json')
let facts: ImageFact[] = []
try {
	facts = JSON.parse(await readFile(factsPath, 'utf8')) as ImageFact[]
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
for (const image of facts) {
	if (!reviewSamples) {
		image.mediaPath = `.data/media/${image.id}.webp`
		image.stagedPath = `.data/image-generation/generated/${image.id}.webp`
	}
}
let saveQueue = Promise.resolve()
async function saveFacts() {
	const next = saveQueue.then(() =>
		reviewSamples
			? writeFile(factsPath, JSON.stringify(facts, null, '\t') + '\n', {
					mode: 0o600,
				})
			: writeAssetCacheFile(
					factsPath,
					JSON.stringify(facts, null, '\t') + '\n',
				),
	)
	saveQueue = next
	await next
}
if (reviewPath) {
	const reviews = JSON.parse(await readFile(reviewPath, 'utf8')) as Record<
		string,
		{ facts: string[]; status: 'approved' | 'rejected'; note?: string }
	>
	for (const image of facts) {
		const review = reviews[image.id]
		if (review) {
			image.verifiedFacts = review.facts
			image.review = { status: review.status, note: review.note }
		}
	}
	await saveFacts()
}
const secretPath = resolve('.data/secrets/image-providers.json')
if ((await stat(secretPath)).mode & 0o077)
	throw Error('IMAGE_SECRET_PERMISSIONS_REQUIRE_0600')
const credentials = JSON.parse(
	await readFile(resolve('.data/secrets/image-providers.json'), 'utf8'),
) as Record<string, { baseUrl: string; apiKey: string; model?: string }>
if (
	reviewSamples &&
	credentials.junlin?.baseUrl !== 'https://canvas.api-hub.asia/v1'
)
	throw Error('SAMPLE_PRICE_CHANNEL_MISMATCH')
const priceResponse = await fetch(pricingSources.junlin, {
	signal: AbortSignal.timeout(20000),
})
if (!priceResponse.ok) throw Error('PRICE_UNAVAILABLE_STOP')
const priceData = (await priceResponse.json()) as {
	data: {
		groups: Array<{
			id: number
			name: string
			description: string
			models: Array<{
				name: string
				pricing: {
					per_request_price: number
					intervals?: Array<{ per_request_price: number | null }>
				}
			}>
		}>
	}
}
const quote = priceData.data.groups.flatMap((group) =>
	group.models
		.filter((model) => model.name === 'gpt-image-2.5')
		.map((model) => ({
			groupId: group.id,
			name: group.name,
			description: group.description,
			model,
		})),
)
const sampleGptReserveUsd = 0.04
const checkedReserveUsd = reviewSamples ? sampleGptReserveUsd : reserveUsd
if (
	!quote.length ||
	quote.some(
		(row) =>
			!Number.isFinite(row.model.pricing.per_request_price) ||
			row.model.pricing.per_request_price <= 0 ||
			row.model.pricing.per_request_price > checkedReserveUsd ||
			row.model.pricing.intervals?.some(
				(interval) =>
					interval.per_request_price !== null &&
					interval.per_request_price > checkedReserveUsd,
			),
	)
)
	throw Error('PRICE_UNVERIFIED_STOP')
await writeFile(
	join(reviewSamples ? sampleDirectory : root, 'price-evidence.json'),
	JSON.stringify(
		{
			checkedAt: new Date().toISOString(),
			gpt: quote,
			maximumAdvertisedChannelReserveUsd: checkedReserveUsd,
			volcengine: {
				model: 'doubao-seedream-5-0-flash-260915',
				perImageCny: 0.12,
				conservativeReserveUsd: 0.12,
				source: pricingSources.volcengine,
			},
		},
		null,
		'\t',
	),
	{ mode: 0o600 },
)
const resumeProvider = value('--resume-provider', '')
if (resumeProvider) {
	if (resumeProvider !== 'volcengine') throw Error('INVALID_RESUME_PROVIDER')
	await ledgerTask((ledger) => {
		delete ledger.stoppedProviders?.[resumeProvider]
	})
	await writeFile(
		join(root, 'provider-resumed-' + Date.now() + '.json'),
		JSON.stringify({
			provider: resumeProvider,
			at: new Date().toISOString(),
			reason:
				'User enabled model and explicitly requested retry; historical reservations retained',
		}),
	)
}
const stopped = new Set<string>()
async function generate(scene: Scene) {
	if (stopped.has(scene.provider)) return
	const existing = facts.find((row) => row.id === scene.id)
	if (existing) {
		let file = existing.stagedPath ?? existing.mediaPath
		try {
			await stat(file)
		} catch {
			file = join(directory, existing.file)
			await stat(file)
		}
		if (!reviewSamples) {
			await mkdir(resolve('.data/media'), { recursive: true })
			await copyFile(file, existing.mediaPath)
		}
		return
	}
	const checkpoint = await ledgerTask((ledger) => ({
		attempts: ledger.entries.filter((row) => row.sceneId === scene.id),
		stopped: ledger.stoppedProviders?.[scene.provider],
	}))
	const attempts = checkpoint.attempts
	const reopening =
		argv.includes('--retry-opened-model') &&
		attempts.length === 2 &&
		attempts.every((row) => row.error?.startsWith('HTTP_404'))
	if (
		checkpoint.stopped &&
		!(argv.includes('--retry-failed') && attempts.length === 1)
	)
		return
	if (
		attempts.length &&
		(!argv.includes('--retry-failed') || (attempts.length >= 2 && !reopening))
	)
		return
	const entry: Entry = {
		id: randomUUID(),
		sceneId: scene.id,
		provider: scene.provider,
		status: 'reserved',
		reservedUsd:
			reviewSamples && scene.provider === 'junlin'
				? sampleGptReserveUsd
				: reserveUsd,
		at: new Date().toISOString(),
	}
	await ledgerTask((ledger) => {
		const consumed = ledger.entries
			.filter((row) => row.provider === scene.provider)
			.reduce((total, row) => total + row.reservedUsd, 0)
		if (
			reviewSamples &&
			scene.provider === 'junlin' &&
			ledger.entries.filter(
				(row) =>
					row.sceneId.startsWith('style-review-v2-') &&
					row.provider === 'junlin',
			).length >= 2
		)
			throw Error('SAMPLE_REQUEST_LIMIT')
		if (
			!ledger.unlimitedProviders?.[scene.provider] &&
			consumed + entry.reservedUsd > ledger.limits[scene.provider]! + 1e-9
		)
			throw Error('IMAGE_BUDGET_EXHAUSTED')
		ledger.entries.push(entry)
	})
	const model =
		scene.provider === 'junlin'
			? 'gpt-image-2.5'
			: 'doubao-seedream-5-0-flash-260915'
	const prompt =
		(scene.kind === 'photo'
			? '用途：校园生活社区配图，合成生活场景，不冒充任何真实校园实拍。普通学生随手手机照片，画面略歪、自然杂物、普通光线、轻微噪点，不过度锐化和虚化，不是商品摄影，不是广告，不是电影大片。'
			: '用途：校园生活社区原创图片表情。简单手绘线条和柔和纯色，无文字、无标志，不模仿现有IP。') +
		scene.subject +
		(reviewSamples
			? '。方形照片，像聊天随手发的一张快照，允许局部裁切，没有专业构图，不模拟海报或文字排版。无可读文字、校名、品牌、水印、海报、拼图、代码、终端界面。'
			: '。方形构图，主体完整。无可读文字、校名、品牌、水印、海报、拼图、代码、终端界面。')
	try {
		const credential = credentials[scene.provider]!
		const response = await fetch(credential.baseUrl + '/images/generations', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${credential.apiKey}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify(
				scene.provider === 'junlin'
					? { model, prompt, n: 1, size: '1024x1024', quality: 'low' }
					: {
							model,
							prompt,
							size: '2K',
							response_format: 'url',
							watermark: false,
						},
			),
			signal: AbortSignal.timeout(180000),
		})
		entry.requestId =
			response.headers.get('x-request-id') ??
			response.headers.get('x-tt-logid') ??
			undefined
		if (!response.ok) {
			if (response.status === 401 || response.status === 403)
				stopped.add(scene.provider)
			const detail = (await response.json().catch(() => null)) as {
				error?: { code?: string; message?: string }
			} | null
			await writeFile(
				join(root, 'error-' + entry.id + '.json'),
				JSON.stringify({
					status: response.status,
					code: detail?.error?.code,
					message: detail?.error?.message?.replaceAll(
						credential.apiKey,
						'[REDACTED]',
					),
				}),
			)
			const detailCode =
				detail?.error?.code?.replace(/[^A-Za-z0-9]/g, '_').toUpperCase() ??
				'NO_ERROR_BODY'
			throw Error(`HTTP_${response.status}_${detailCode}`)
		}
		const body = (await response.json()) as {
			data?: Array<{ b64_json?: string; url?: string }>
			usage?: unknown
			error?: { code?: string }
		}
		if (body.error) throw Error(`PROVIDER_${body.error.code ?? 'ERROR'}`)
		const image = body.data?.[0]
		let bytes: Buffer
		if (image?.b64_json) bytes = Buffer.from(image.b64_json, 'base64')
		else if (image?.url) {
			const remote = new URL(image.url)
			if (remote.protocol !== 'https:') throw Error('INVALID_MEDIA_URL')
			const download = await fetch(remote, {
				signal: AbortSignal.timeout(60000),
			})
			if (!download.ok) throw Error(`DOWNLOAD_${download.status}`)
			bytes = Buffer.from(await download.arrayBuffer())
		} else throw Error('MISSING_IMAGE')
		const decoded = sharp(bytes, {
			limitInputPixels: 40000000,
			failOn: 'warning',
		})
		const metadata = await decoded.metadata()
		if (
			!metadata.width ||
			!metadata.height ||
			metadata.width < 512 ||
			metadata.height < 512
		)
			throw Error('INVALID_IMAGE')
		const webp = await decoded.webp({ quality: 88 }).toBuffer()
		const file = `${scene.id}.webp`
		const stagedPath = reviewSamples
			? join(sampleDirectory, file)
			: `.data/image-generation/generated/${file}`
		if (reviewSamples)
			await writeFile(
				join(
					sampleDirectory,
					`${scene.id}.original${metadata.format === 'jpeg' ? '.jpg' : '.' + metadata.format}`,
				),
				bytes,
			)
		await mkdir(join(root, 'generated'), { recursive: true })
		await writeFile(stagedPath, webp)
		const mediaPath = reviewSamples
			? stagedPath
			: `.data/media/${scene.id}.webp`
		if (!reviewSamples) {
			await mkdir(resolve('.data/media'), { recursive: true })
			await writeFile(mediaPath, webp)
		}
		facts.push({
			id: scene.id,
			provider: scene.provider,
			model,
			kind: scene.kind,
			file,
			mediaPath,
			stagedPath,
			url: `/media/${scene.id}.webp`,
			sha256: createHash('sha256').update(webp).digest('hex'),
			width: metadata.width,
			height: metadata.height,
			topics: scene.topics,
			plannedFacts: scene.facts,
			verifiedFacts: [],
			review: { status: 'pending' },
			prompt,
		})
		await saveFacts()
		await ledgerTask((ledger) => {
			const row = ledger.entries.find((row) => row.id === entry.id)!
			row.status = 'generated'
			row.requestId = entry.requestId
			row.usage = body.usage
		})
		console.log(
			JSON.stringify({
				id: scene.id,
				status: 'generated',
				provider: scene.provider,
				reserveUsd: entry.reservedUsd,
			}),
		)
	} catch (error) {
		stopped.add(scene.provider)
		const code = error instanceof Error ? error.message : 'UNKNOWN'
		await ledgerTask((ledger) => {
			const row = ledger.entries.find((row) => row.id === entry.id)!
			ledger.stoppedProviders ??= {}
			ledger.stoppedProviders[scene.provider] = /^[A-Z_0-9]+$/.test(code)
				? code
				: 'REQUEST_OR_STORAGE_FAILED'
			row.status = 'failed'
			row.requestId = entry.requestId
			row.error = /^[A-Z_0-9]+$/.test(code) ? code : 'REQUEST_OR_STORAGE_FAILED'
		})
		console.log(
			JSON.stringify({
				id: scene.id,
				status: 'failed',
				provider: scene.provider,
				error: /^[A-Z_0-9]+$/.test(code) ? code : 'REQUEST_OR_STORAGE_FAILED',
				reservationRetained: true,
			}),
		)
	}
}
if (!argv.includes('--review-only')) {
	const queue = (reviewSamples ? sampleScenes : scenes)
		.slice(0, reviewSamples ? 4 : limit)
		.filter(
			(scene) => providerFilter === 'all' || scene.provider === providerFilter,
		)
	// Two workers is the hard upper bound; ledger reservation is serialized before every request.
	let cursor = 0
	await Promise.all(
		[0, 1].map(async () => {
			while (cursor < queue.length) {
				const scene = queue[cursor++]!
				try {
					await generate(scene)
				} catch (error) {
					stopped.add(scene.provider)
					console.log(
						JSON.stringify({
							provider: scene.provider,
							status: 'stopped',
							reason:
								error instanceof Error &&
								error.message === 'IMAGE_BUDGET_EXHAUSTED'
									? 'IMAGE_BUDGET_EXHAUSTED'
									: 'CHECKPOINT_ERROR',
						}),
					)
				}
			}
		}),
	)
}
if (!reviewSamples) {
	const manifestPath = join(directory, 'manifest.json')
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Array<
		Record<string, unknown>
	>
	for (const image of facts.filter((row) => row.review.status === 'approved')) {
		await writeAssetCacheFile(
			join(directory, image.file),
			await readFile(image.stagedPath ?? image.mediaPath).catch(() =>
				readFile(join(directory, image.file)),
			),
		)
		const asset = {
			id: image.id,
			file: image.file,
			url: image.url,
			mime: 'image/webp',
			width: image.width,
			height: image.height,
			alt: image.verifiedFacts.join('、'),
			origin: 'Generated',
			sourceUrl: null,
			attribution: null,
			license: 'Generated image; use subject to provider terms',
			tags: image.topics,
		}
		const index = manifest.findIndex((row) => row.id === image.id)
		if (index >= 0) manifest[index] = asset
		else manifest.push(asset)
	}
	await writeAssetCacheFile(
		manifestPath,
		JSON.stringify(manifest, null, '\t') + '\n',
	)
	for (const kind of ['photo', 'sticker']) {
		const list = facts
			.filter((row) => row.kind === kind && row.review.status === 'approved')
			.map((row) => ({
				id: row.id,
				file: row.file,
				url: row.url,
				width: row.width,
				height: row.height,
				topics: row.topics,
				facts: row.verifiedFacts,
			}))
		await writeAssetCacheFile(
			join(
				directory,
				kind === 'photo' ? 'natural-photos.json' : 'natural-stickers.json',
			),
			JSON.stringify(list, null, '\t') + '\n',
		)
	}
	const contactDirectory = resolve(
		value('--contact-directory', '.data/image-generation/contact-sheets'),
	)
	await mkdir(contactDirectory, { recursive: true })
	const ordered = [...facts].sort((a, b) => a.id.localeCompare(b.id))
	for (let offset = 0; offset < ordered.length; offset += 12) {
		const page = ordered.slice(offset, offset + 12)
		const layers = await Promise.all(
			page.map(async (row, index) => ({
				input: await sharp(row.mediaPath)
					.resize(320, 320, { fit: 'contain', background: 'white' })
					.toBuffer(),
				left: (index % 4) * 320,
				top: Math.floor(index / 4) * 350,
			})),
		)
		for (let index = 0; index < page.length; index++)
			layers.push({
				input: Buffer.from(
					`<svg width="320" height="30"><text x="8" y="20" font-size="14">${page[index]!.id}</text></svg>`,
				),
				left: (index % 4) * 320,
				top: Math.floor(index / 4) * 350 + 320,
			})
		await sharp({
			create: {
				width: 1280,
				height: Math.ceil(page.length / 4) * 350,
				channels: 3,
				background: 'white',
			},
		})
			.composite(layers)
			.png()
			.toFile(
				join(
					contactDirectory,
					`contact-${String(offset / 12 + 1).padStart(2, '0')}.png`,
				),
			)
	}
	if (argv.includes('--pack')) {
		const result = await packAssetCache()
		if (!result.cacheStateUpdated)
			throw Error('ASSET_ARCHIVE_COMMITTED_CACHE_STATE_FAILED_STOP')
		console.log(JSON.stringify({ archive: result }))
	}
	console.log(
		JSON.stringify({
			generated: facts.length,
			approved: facts.filter((row) => row.review.status === 'approved').length,
			limits: await ledgerTask((ledger) =>
				Object.fromEntries(
					Object.keys(ledger.limits).map((provider) => [
						provider,
						{
							limitUsd: ledger.limits[provider],
							reservedEstimatedUsd: Number(
								ledger.entries
									.filter((row) => row.provider === provider)
									.reduce((n, row) => n + row.reservedUsd, 0)
									.toFixed(2),
							),
						},
					]),
				),
			),
		}),
	)
} else {
	console.log(
		JSON.stringify({
			reviewSamples: true,
			generated: facts.length,
			approved: 0,
			directory: sampleDirectory,
		}),
	)
}
