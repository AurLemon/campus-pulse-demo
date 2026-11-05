import { mkdir, readFile, stat } from 'node:fs/promises'
import sharp from 'sharp'
import { join } from 'node:path'
import {
	ensureAssetCache,
	getAssetCacheDirectory,
	packAssetCache,
	writeAssetCacheFile,
} from './asset-bundle.ts'

const assets = [
	{
		id: 'photo-badminton',
		photo: 8476139,
		tags: ['sports'],
		alt: '羽毛球拍与羽毛球',
		author: 'Amit Rai',
		page: 'close-up-shot-of-a-shuttlecock-on-a-racket-8476139',
	},
	{
		id: 'photo-shuttle',
		photo: 13701956,
		tags: ['sports'],
		alt: '草地上的球拍与羽毛球',
		author: 'Anurag Sharma',
		page: 'shuttlecock-on-badminton-racket-13701956',
	},
	{
		id: 'photo-track',
		photo: 18502968,
		tags: ['sports'],
		alt: '红色跑道与白色分道线',
		author: 'Jan van der Wolf',
		page: 'surface-of-an-empty-running-track-18502968',
	},
	{
		id: 'photo-guitar',
		photo: 32608373,
		tags: ['music'],
		alt: '木桌旁的木吉他',
		author: 'James Collington',
		page: 'acoustic-guitar-resting-on-wooden-coffee-table-32608373',
	},
	{
		id: 'photo-autumn',
		photo: 40372984,
		tags: ['photography'],
		alt: '阳光照过秋日树叶',
		author: 'John Riches',
		page: 'vibrant-autumn-leaves-in-sunlight-40372984',
	},
	{
		id: 'photo-camera',
		photo: 27084012,
		tags: ['photography'],
		alt: '桌面上的相机',
		author: 'Beyza Nur Yurtçu',
		page: 'camera-on-table-27084012',
	},
	{
		id: 'photo-gear',
		photo: 10391352,
		tags: ['photography'],
		alt: '桌面上的摄影器材',
		author: 'Igor Justo',
		page: 'camera-equipment-on-the-table-10391352',
	},
	{
		id: 'photo-code',
		photo: 37085304,
		tags: ['technology'],
		alt: '打开代码编辑器的笔记本电脑',
		author: 'Pexels contributor',
		page: 'remote-work-setup-with-coding-on-laptop-37085304',
	},
	{
		id: 'photo-court',
		photo: 12896161,
		tags: ['sports'],
		alt: '阳光下的室外球场',
		author: 'Sonny Sixteen',
		page: 'an-empty-basketball-court-12896161',
	},
	{
		id: 'photo-court-blue',
		photo: 31174804,
		tags: ['sports'],
		alt: '蓝色球场俯视图',
		author: 'Kenan Turguç',
		page: 'aerial-view-of-empty-outdoor-basketball-court-31174804',
	},
	{
		id: 'photo-sketch',
		photo: 30345419,
		tags: ['art'],
		alt: '素描本和彩色铅笔',
		author: 'Noemí Jiménez',
		page: 'set-of-colored-pencils-and-blank-sketchbook-30345419',
	},
	{
		id: 'photo-drawing',
		photo: 4249200,
		tags: ['art'],
		alt: '画稿、铅笔与画笔',
		author: 'Pexels contributor',
		page: 'paper-with-picture-near-colored-pencils-and-brushes-4249200',
	},
	{
		id: 'photo-books',
		photo: 30618330,
		tags: ['reading', 'volunteer'],
		alt: '书架上的书籍',
		author: 'İrem Çevik',
		page: 'stacked-books-and-magazines-in-library-shelves-30618330',
	},
	{
		id: 'photo-old-books',
		photo: 5009083,
		tags: ['reading', 'volunteer'],
		alt: '整理成摞的旧书',
		author: 'Pexels contributor',
		page: 'stacks-of-old-books-5009083',
	},
	{
		id: 'photo-microphone',
		photo: 17722679,
		tags: ['music'],
		alt: '灯光下的话筒',
		author: 'Karla De León',
		page: 'a-microphone-is-shown-in-front-of-a-stage-17722679',
	},
	{
		id: 'photo-stage',
		photo: 15609007,
		tags: ['music'],
		alt: '舞台上的麦克风',
		author: 'el jusuf',
		page: 'microphone-on-the-stage-15609007',
	},
	{
		id: 'photo-notebook',
		photo: 4443161,
		tags: ['career'],
		alt: '笔记本和电脑旁的手写记录',
		author: 'Pexels contributor',
		page: 'a-person-holding-pen-and-a-notebook-4443161',
	},
]
const directory = getAssetCacheDirectory()
let archiveExists = true
try {
	await stat(new URL('./assets.tar.gz', import.meta.url))
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	archiveExists = false
}
if (archiveExists) await ensureAssetCache()
else await mkdir(directory, { recursive: true })
const manifest = []
for (const asset of assets) {
	const file = join(directory, `${asset.id}.webp`)
	let bytes: Buffer
	try {
		bytes = await readFile(file)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		const response = await fetch(
			`https://images.pexels.com/photos/${asset.photo}/pexels-photo-${asset.photo}.jpeg?auto=compress&cs=tinysrgb&w=1200`,
			{ signal: AbortSignal.timeout(30000) },
		)
		if (!response.ok)
			throw new Error(`ASSET_FETCH:${asset.id}:${response.status}`, {
				cause: error,
			})
		bytes = await sharp(Buffer.from(await response.arrayBuffer()))
			.rotate()
			.resize({ width: 1200, withoutEnlargement: true })
			.webp({ quality: 82 })
			.toBuffer()
		await writeAssetCacheFile(file, bytes)
	}
	const metadata = await sharp(bytes).metadata()
	manifest.push({
		id: asset.id,
		file: `${asset.id}.webp`,
		tags: asset.tags,
		url: `/media/${asset.id}.webp`,
		mime: 'image/webp',
		width: metadata.width!,
		height: metadata.height!,
		alt: asset.alt,
		origin: 'Stock',
		sourceUrl: `https://www.pexels.com/photo/${asset.page}/`,
		attribution: `${asset.author} / Pexels`,
		license: 'https://www.pexels.com/license/',
	})
	console.log(asset.id, bytes.length)
}
await writeAssetCacheFile(
	join(directory, 'manifest.json'),
	JSON.stringify(manifest, null, '\t'),
)

const bundle = await packAssetCache()
console.log(JSON.stringify(bundle))
if (!bundle.cacheStateUpdated) process.exitCode = 1
