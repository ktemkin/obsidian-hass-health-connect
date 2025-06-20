import { App, requestUrl, TFile, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { date, timestamp, SensorData, StepReadingSet, CalorieReadingSet, ExerciseReadingSet, HeartRateReadingSet, HydrationReadingSet, BloodOxygenReadingSet, SleepReadingSet, WeightReadingSet, HeartRateReadingDay } from "./types";
import { createDailyNote } from 'obsidian-daily-notes-interface'

//
// Settings types.
//

interface HassConnectSettings {
	token: string
	instance_uri: string
	sensor: string

	/// Determines if we should automatically create daily notes.
	create_daily_notes: boolean,

	/// The front-matter field to be updated with total calories burned.
	calorie_field: string

	/// The front-matter field to be updated with total minutes of exercise.
	exercise_field: string

	/// The front-matter field to be updated with total water consumed.
	hydration_field: string

	/// The front-matter field to be updated with total steps taken.
	steps_field: string

	/// The front-matter field to be updated with the day's measured weight.
	weight_field: string

	/// The section in the daily note to be populated with heartrate data.
	heartrate_section: string
}

const DEFAULT_SETTINGS: HassConnectSettings = {
	token: '',
	instance_uri: '',
	sensor: 'health_connect',

	create_daily_notes: true,

	calorie_field: "active_calories",
	exercise_field: "exercise_minutes",
	hydration_field: "hydration_ml",
	steps_field: "steps",
	weight_field: "weight",

	heartrate_section: "Hartslag Data"
}

// Health connect provides certain special values where it otherwise provides dates.
// This list helps us filter them out.
const IGNORED_DATES = ["lastSleep"];


// Table header for our heartrate table.
const HEARTRATE_TABLE_HEADER = `
| Time     | BPM  |
|----------|------|
`;

//
// Plugin types.
//

/// Type for a function that converts an object to a string describing
/// one of its properties.
type SelectorFunction = (v: any) => string;

export default class HassConnectPlugin extends Plugin {
	settings: HassConnectSettings;

	async onload() {
		await this.loadSettings();

		//
		// Commands.getDailyNote
		//
		this.addCommand({
			id: 'sync-data-now',
			name: 'Sync Health Connect history now',
			callback: async () => { this.runSync(); }
		});

		// Set up our settings.
		this.addSettingTab(new HassConnectSettingsTab(this.app, this));

		// Set up our background refresh interval.
		//this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async runSync() {
		// Fetch the raw sensor data...
		let sensorData = await this.fetchSensorData()
		if (sensorData === null) {
			return;
		}

		/// ... and update our various sensors.
		await this.updateCalories(sensorData.calories)
		await this.updateExercise(sensorData.exercise)
		await this.updateHeartrate(sensorData.heart)
		await this.updateHydration(sensorData.hydration)
		await this.updateBloodOxygen(sensorData.oxygen)
		await this.updateSleep(sensorData.sleep)
		await this.updateSteps(sensorData.steps)
		await this.updateWeight(sensorData.weight)
	}

	// Returns the daily note path for the given Moment.
	private dailyNotePathFor(moment: any): string {

		// HACK: Fetch the existing daily note format and folder from inside Obsidian.
		const daily_note_format = this.app.internalPlugins.plugins["daily-notes"].instance.options.format;
		const daily_note_folder = this.app.internalPlugins.plugins["daily-notes"].instance.options.folder;

		// Convert the provided date into the target format.
		const formatted_filename = moment.format(daily_note_format)
		return `${daily_note_folder}/${formatted_filename}.md`
	}

	/// Gets the daily note for a provided Health-Connect style date.
	private async dailyNoteFor(raw_date: date): Promise<TFile> {
		const date = window.moment(raw_date, "YYYY-MM-DD")

		const daily_note_path = this.dailyNotePathFor(date)
		let daily_note = this.app.fileManager.vault.getFileByPath(daily_note_path)

		/// If we don't have a daily note, and we're set to create one, do so.
		if ((daily_note === null) && this.settings.create_daily_notes) {
			daily_note = await createDailyNote(date)
		}

		return daily_note
	}

	/// Updates the provided front-matter field in the daily note for the given date.
	private async updateFrontMatter(target_date: date, field: string, value: string) {
		let file_to_edit = await this.dailyNoteFor(target_date)

		if (file_to_edit === null) {
			console.error(`failed to open daily note for ${target_date}`)
		}

		this.app.fileManager.processFrontMatter(file_to_edit, frontmatter => {
			frontmatter[field] = value
		})
	}

	/// Helper which automatically updates the front-matter in a number of notes when provided
	/// with date-keyed readings. For example if field is "my_front_matter_property" and readings are
	//  {"2024-01-20": myObject} the selector function will be called on myObject, and the result of that
	//  function willl be put into the front matter field "my_front_matter_property" 
	private async updateFrontMatterByField(readings: any, field: string, selector: SelectorFunction) {

		// Ignore missing/error'd readings.
		if ((readings === null) || (readings === undefined)) {
			return
		}

		// Update the front matter for each relevant day's note.
		for (const date in readings) {

			// Skip any ignored date keywords.
			if (IGNORED_DATES.contains(date)) {
				continue;
			}

			// ... but otherwise, process every date.
			const reading = readings[date]
			const value = selector(reading)
			if (value != 'undefined') {
				await this.updateFrontMatter(date, field, value)
			}
		}
	}


	private async replaceSection(date: date, section_heading: string, section_content: string) {
		console.log(date)
		console.log(section_heading)
		console.log(section_content)
	}


	/// Log active calories to the relevant daily note.
	private async updateCalories(readings: CalorieReadingSet | null | undefined) {
		await this.updateFrontMatterByField(readings, this.settings.calorie_field, e => String(e.energy))
	}

	/// Log exercise information to the relevant daily note.
	private async updateExercise(readings: ExerciseReadingSet | null | undefined) {
		await this.updateFrontMatterByField(readings, this.settings.exercise_field, e => String(Math.floor(e.totalDuration / 60)))
	}


	private renderTime(time: timestamp): string {
		return window.moment(time, "X").format("HH:mm:ss")
	}


	/// Updates a table of heart rates for the relevant day.
	private async updateHeartrate(readings: HeartRateReadingSet | null | undefined) {
		// Ignore missing/error'd readings.
		if ((readings === null) || (readings === undefined)) {
			return
		}

		console.log(readings)

		// Process heart-rate data one day at a time.
		for (const date in readings) {
			const samples: HeartRateReadingDay = readings[date]

			// Create a table from all of our samples.
			let new_table = HEARTRATE_TABLE_HEADER
			for (const time in samples) {
				const sample = samples[time]
				const print_time = this.renderTime(sample.time)

				new_table += `| ${print_time} | ${String(sample.bpm).padStart(3)}  |\n`
			}

			// Append a table identifier, so this can be used with charts.
			new_table += "^heartrate\n\n"
			this.replaceSection(date, this.settings.heartrate_section, new_table)
		}
	}

	private async updateHydration(readings: HydrationReadingSet | null | undefined) {
		await this.updateFrontMatterByField(readings, this.settings.hydration_field, e => String(e.volume))
	}


	private async updateBloodOxygen(readings: BloodOxygenReadingSet | null | undefined) {
		// Ignore missing/error'd readings.
		if ((readings === null) || (readings === undefined)) {
			return
		}

		// FIXME: todo
	}
	private async updateSleep(readings: SleepReadingSet | null | undefined) {
		// Ignore missing/error'd readings.
		if ((readings === null) || (readings === undefined)) {
			return
		}

		// FIXME: todo
	}

	private async updateSteps(readings: StepReadingSet | null | undefined) {
		await this.updateFrontMatterByField(readings, this.settings.steps_field, e => String(e.count))
	}

	private async updateWeight(readings: WeightReadingSet | null | undefined) {
		await this.updateFrontMatterByField(readings, this.settings.weight_field, e => String(Object.values(e).last()))
	}


	/// Fetches the current sensor data from HA, and returns it as a JSON object.
	private async fetchSensorData(): Promise<SensorData | null> {

		// Fetch the _raw_ sensor state for the object...
		let response = await requestUrl({
			url: this.getSensorURL(),
			headers: this.getRequestHeaders(),
			throw: false,
		})

		if (response.status == 404) {
			new Notice("No data to update; this is normal after a restart.")
			return null
		}

		if (response.status != 200) {
			new Notice("unable to fetch Health Connect data; check plugin configuration")
			console.log(this.getSensorURL())
			console.error(response.status)
			return null
		}

		return response.json.attributes
	}

	/// Fetches the requestURL target needed to get our sensor data.
	private getSensorURL(): string {
		let separator = this.settings.instance_uri.endsWith("/") ? "" : "/"
		let sensor_prefix = this.settings.sensor.startsWith("sensor.") ? "" : "sensor."

		return `${this.settings.instance_uri}${separator}api/states/${sensor_prefix}${this.settings.sensor}`
	}

	private getRequestHeaders(): Record<string, string> {
		return {
			'Authorization': `Bearer ${this.settings.token} `,
			'Content-Type': 'application/json'
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}
}

class HassConnectSettingsTab extends PluginSettingTab {
	plugin: HassConnectPlugin;

	constructor(app: App, plugin: HassConnectPlugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const { containerEl } = this
		containerEl.empty()

		///
		/// Main settings section.
		///
		new Setting(containerEl)
			.setName('Home Assistant URI')
			.setDesc('The URI used to access your home assistant instance.')
			.addText(text => text
				.setPlaceholder('http://localhost:8123/')
				.setValue(this.plugin.settings.instance_uri)
				.onChange(async (value) => {
					this.plugin.settings.instance_uri = value;
					await this.plugin.saveSettings()
				}))
		new Setting(containerEl)
			.setName('Home Assistant Token')
			.setDesc('A long-lived access token; as created from Security in your user profile.')
			.addText(text => text
				.setPlaceholder('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy.zzzzzzzzzzzzzzzzzzz-zzzzzzzzzzzzzzzzzzzzzzz')
				.setValue(this.plugin.settings.token)
				.onChange(async (value) => {
					this.plugin.settings.token = value;
					await this.plugin.saveSettings()
				}))
		new Setting(containerEl)
			.setName('Sensor')
			.setDesc('The sensor name you selected in the HealthConnnect-to-HomeAssistant helper app.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.sensor)
				.setValue(this.plugin.settings.sensor)
				.onChange(async (value) => {
					this.plugin.settings.sensor = value;
					await this.plugin.saveSettings()
				}))


	}
}
