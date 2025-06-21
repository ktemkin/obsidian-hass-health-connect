import { App, requestUrl, TFile, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { date, timestamp, SleepStage, SensorData, StepReadingSet, CalorieReadingSet, ExerciseReadingSet, HeartRateReadingSet, HydrationReadingSet, BloodOxygenReadingSet, SleepReadingSet, WeightReadingSet, HeartRateReadingDay } from "./types";
import { createDailyNote } from 'obsidian-daily-notes-interface'

//
// Settings types.
//

interface HassConnectSettings {
    token: string
    instance_uri: string
    sensor: string

    /// Background refresh interval.
    refresh_interval: number

    /// Determines if we should automatically create daily notes.
    create_daily_notes: boolean

    /// Whether to format times, which makes them more human readable.
    /// If they're unfomatted, they work better with charting and machine tools.
    format_times: boolean,

    /// Subfolder in which table section data should be placed,
    /// or an empty string to put the data inline.
    tables_subfolder: string

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

    /// The front-matter field to be updated with the total sleep for a given day.
    total_sleep_field: string

    /// The section in the daily note to be populated with heartrate data.
    heartrate_section: string

    /// The section in the daily note to be populated with SP02 data.
    blood_oxygen_section: string

    /// The section in which to place a list of all exercies done.
    exercise_list_section: string

    /// A section in which to put an summary, if provided.
    summary_section: string
}

const DEFAULT_SETTINGS: HassConnectSettings = {
    token: '',
    instance_uri: '',
    sensor: 'health_connect',

    tables_subfolder: "tables",
    create_daily_notes: true,
    refresh_interval: 1000 * 60 * 60 * 6,
    format_times: false,

    calorie_field: "Active Calories",
    exercise_field: "Exercise Minutes",
    hydration_field: "mL Hydrated",
    steps_field: "Steps",
    weight_field: "Weight",

    total_sleep_field: "Total Sleep",

    heartrate_section: "Heartrate", // XXX
    blood_oxygen_section: "Blood Oxygen", // XXX
    exercise_list_section: "Oefening", // XXX
    summary_section: "Gezondheid", // XXX
}

// Health connect provides certain special values where it otherwise provides dates.
// This list helps us filter them out.
const IGNORED_DATES = ["lastSleep"];

// Sleep stages we don't want to include in our counts.
const UNCOUNTED_SLEEP_STAGES = ["Awake"];

// Exercise-type mappings for Samsung Health.
const EXERCISE_TYPE_MAPPINGS: Record<string, string> = {
    "Treadmill Running": "Treadmill"
}

//
// Plugin types.
//

/// Type for a function that converts an object to a string describing
/// one of its properties.
type SelectorFunction = (v: any) => string;

export default class HassConnectPlugin extends Plugin {
    settings: HassConnectSettings;
    summary: Record<date, Record<string, string>>

    async onload() {
        await this.loadSettings();
        this.summary = {};

        //
        // Commands.
        //
        this.addCommand({
            id: 'sync-data-now',
            name: 'Sync Health Connect history now',
            callback: async () => { this.runSync(); }
        });

        // Set up our settings.
        this.addSettingTab(new HassConnectSettingsTab(this.app, this));

        // Set up our background refresh interval.
        // We'll schedule our first refresh one minute after opening; and then 
        this.registerInterval(window.setInterval(async () => await this.runSync(), this.settings.refresh_interval))
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
        await this.updateSummary()

        // This was a long-running operation, so notify that we're done.
        new Notice("Health Connect data sync'd.")
    }

    private async updateSummary() {
        // If we don't have a summary section, render nothing.
        if (this.settings.summary_section == "") {
            return
        }

        // Otherwise, generate a short summary block for each date, in Dataview format.
        for (const date in this.summary) {
            let summary_section = "\n"
            let daily_summary = this.summary[date]

            for (const field in daily_summary) {
                let value = daily_summary[field]
                summary_section += `**${field}**:: ${value}\n`
            }

            this.replaceSection(date, this.settings.summary_section, summary_section, false)
        }

    }


    // HACK: fetch an internal plugin while working around the proper API, because sin
    private getInternalPlugin(plugin_name: string) {
        const _hack: any = this.app
        return _hack.internalPlugins.plugins[plugin_name]
    }

    // Returns the daily note path for the given Moment.
    private async dailyNotePathFor(moment: any, for_table: boolean): Promise<string> {

        // HACK: Fetch the existing daily note format and folder from inside Obsidian.
        const daily_note_format: string = this.getInternalPlugin("daily-notes").instance.options.format
        const daily_note_folder: string = this.getInternalPlugin("daily-notes").instance.options.folder

        // Get the section of the daily note path that just refers to the day.
        const daily_note_path_day_section = daily_note_format.split("/").last()
        const daily_note_path_nonday_section = (daily_note_format.split("/").length > 1) ? daily_note_format.split("/").slice(0, -1).join("/") : ""

        // If we have a table suffix, and this is a table, use it.
        if (for_table && (this.settings.tables_subfolder != "")) {
            const formatted_day_section = moment.format(daily_note_path_day_section)
            const formatted_nonday_section = moment.format(daily_note_path_nonday_section)

            // HACK: if we're creating daily notes, make sure the folder for them exists
            const target_subfolder = `${daily_note_folder}/${formatted_nonday_section}/${this.settings.tables_subfolder}`
            if (this.app.vault.getFolderByPath(target_subfolder) == null) {
                await this.app.vault.createFolder(target_subfolder)
            }

            return `${target_subfolder}/${formatted_day_section} Tables.md`

        } else {
            const formatted_filename = moment.format(daily_note_format)
            return `${daily_note_folder}/${formatted_filename}.md`
        }
    }

    /// Returns the initial contents used when creating a table note.
    /// For now, we populate section headers without any contained data.
    private getTableNoteInitialContents(): string {
        let table_note_contents = ""

        if (this.settings.heartrate_section) {
            table_note_contents += `# ${this.settings.heartrate_section}\n\n`
        }
        if (this.settings.blood_oxygen_section) {
            table_note_contents += `# ${this.settings.blood_oxygen_section}\n\n`
        }

        return table_note_contents
    }


    /// Gets the daily note for a provided Health-Connect style date.
    private async dailyNoteFor(raw_date: date, for_table: boolean): Promise<TFile> {
        const date = window.moment(raw_date, "YYYY-MM-DD")

        const daily_note_path = await this.dailyNotePathFor(date, for_table)
        let daily_note = this.app.vault.getFileByPath(daily_note_path)

        /// If we don't have a daily note, and we're set to create one, do so.
        if ((daily_note === null) && this.settings.create_daily_notes) {

            // Special case: if this is for a subfoldered table, create an empty table note instead.
            if (for_table && (this.settings.tables_subfolder != "")) {
                daily_note = await this.app.vault.create(daily_note_path, this.getTableNoteInitialContents())
            }
            else {
                daily_note = await createDailyNote(date)
            }
        }

        if (daily_note === null) {
            throw "unable to create daily note!";
        }

        return daily_note
    }

    /// Updates the provided front-matter field in the daily note for the given date.
    private async updateFrontMatter(target_date: date, field: string, value: string) {
        let file_to_edit = await this.dailyNoteFor(target_date, false)

        if (file_to_edit === null) {
            console.error(`failed to open daily note for ${target_date}`)
        }

        this.app.fileManager.processFrontMatter(file_to_edit, frontmatter => {
            frontmatter[field] = value
        })

        /// Also store the field in our summary, for later use.
        this.storeToSummary(target_date, field, value)
    }

    private storeToSummary(target_date: date, field: string, value: string) {

        // Bootstrap our date if it doesn't exist.
        if (this.summary[target_date] == undefined) {
            this.summary[target_date] = {};
        }

        this.summary[target_date][field] = value
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

    /// Replaces the content of a section with the proided
    private async replaceSection(date: date, heading_regex: string, new_section_content: string, new_content_is_table: boolean) {

        // If we have an empty heading_regex, vacuously succeed.
        if (heading_regex == "") {
            return
        }

        // Get the daily note we're working with.
        let target_file = await this.dailyNoteFor(date, new_content_is_table)
        const content = await this.app.vault.read(target_file)

        // Build the RegEx that will identify our section, and be sure that it matches.
        const section_regex = RegExp(`(^#+ ${heading_regex}[ ]*\\n)[^#]*((\\n#)|($(?![\r\n])))`, "m")
        if (!section_regex.test(content)) {
            return
        }

        // Replace the relevant section...
        const new_section_content_escaped = new_section_content.replace("$", "$$")
        const new_content = content.replace(section_regex, `$1${new_section_content_escaped}$2`)

        // ... and write the data back.
        await this.app.vault.modify(target_file, new_content)
    }


    /// Log active calories to the relevant daily note.
    private async updateCalories(readings: CalorieReadingSet | null | undefined) {
        await this.updateFrontMatterByField(readings, this.settings.calorie_field, e => String(Math.round(e.energy)))
    }

    /// Log exercise information to the relevant daily note.
    private async updateExercise(readings: ExerciseReadingSet | null | undefined) {
        // Ignore missing/error'd readings.
        if ((readings === null) || (readings === undefined)) {
            return
        }

        for (const date in readings) {
            let days_exercise = readings[date];
            let exercise_list = ""

            // Build each exercise session into a nice list, and then stick it in our note.
            days_exercise.sessions.forEach(session => {
                let exercise_name = EXERCISE_TYPE_MAPPINGS.hasOwnProperty(session.exerciseName)
                    ? EXERCISE_TYPE_MAPPINGS[session.exerciseName]
                    : session.exerciseName

                exercise_list += `  - **${session.durationFormatted}**: ${exercise_name}\n`
            })
            await this.replaceSection(date, this.settings.exercise_list_section, exercise_list, false)

            // Use the summary provided by the API directly, rather than tallying, so we support
            // if a provider doesn't popultae the individual fields.
            const total_exercise = days_exercise.totalDuration / 60;
            await this.updateFrontMatter(date, this.settings.exercise_field, String(Math.round(total_exercise)))
        }
    }


    private renderTime(time: timestamp): string {
        let formatting = this.settings.format_times ? "HH:mm:ss" : "YYYY-MM-DD HH:mm:ss"
        return window.moment(time, "X").format(formatting)
    }


    /// Generates a tabe from a set of data points, and a selector function which renders a given sample.
    private generateTableFromData(readings: any, selector: SelectorFunction, header: string, slug: string): string {

        // First row of our header...
        let new_table = `\n| Time     | ${header} |\n`
        let datum_length = header.length

        // ... second ...
        const dashes_for_header = "-".repeat(datum_length)
        new_table += `|----------|-${dashes_for_header}-|\n`

        // ... the body ...
        for (const time in readings) {
            const sample = readings[time]

            const print_time = this.renderTime(Number(time))
            const print_sample = selector(sample).padStart(header.length)

            new_table += `| ${print_time} | ${print_sample} |\n`
        }

        // ... and the table identifier, in case we want to use it in a chart.
        new_table += `^${slug}\n\n`
        return new_table
    }

    private async updateDailyTables(readings: any, target_section: string, selector: SelectorFunction, header: string, slug: string) {
        // Ignore missing/error'd readings.
        if ((readings === null) || (readings === undefined)) {
            return
        }

        // Process heart-rate data one day at a time.
        for (const date in readings) {
            const samples: HeartRateReadingDay = readings[date]
            const new_table = this.generateTableFromData(samples, selector, header, slug)

            await this.replaceSection(date, target_section, new_table, true)
        }
    }


    /// Updates a table of heart rates for the relevant day.
    private async updateHeartrate(readings: HeartRateReadingSet | null | undefined) {
        await this.updateDailyTables(readings, this.settings.heartrate_section, e => String(e.bpm), "BPM", "heartrate")
    }

    private async updateHydration(readings: HydrationReadingSet | null | undefined) {
        await this.updateFrontMatterByField(readings, this.settings.hydration_field, e => String(e.volume))
    }

    private async updateBloodOxygen(readings: BloodOxygenReadingSet | null | undefined) {
        await this.updateDailyTables(readings, this.settings.blood_oxygen_section, e => String(e), "SpO2 %", "spo2")
    }

    /// Returns the frontmatter key for to be used for the given stage name.
    private getStageKey(formattedName: SleepStage) {
        return formattedName.stageFormat
    }


    private async updateSleep(readings: SleepReadingSet | null | undefined) {
        // Ignore missing/error'd readings.
        if ((readings === null) || (readings === undefined)) {
            return
        }

        for (const date in readings) {
            let days_sleep = readings[date];

            // Skip any non-date inclusions in our array.
            if (IGNORED_DATES.includes(date)) {
                continue
            }

            // Keep a running tally of sleep for the day.
            let total_sleep_minutes = 0

            // Process each stage into frontmatter, and build up our total.
            days_sleep.stage.forEach(stage => {
                const front_matter_key = this.getStageKey(stage)
                let sleep_minutes = 0

                // If this is one of the sleep stages we don't want to count (like "awake"), skip it.
                if (UNCOUNTED_SLEEP_STAGES.includes(stage.stageFormat)) {
                    return
                }

                // Tally the sleep time for each session, in minutes.
                stage.sessions.forEach(session => {
                    sleep_minutes += session.duration / 60
                })

                this.updateFrontMatter(date, front_matter_key, String(sleep_minutes))

                // Tally the total time.
                total_sleep_minutes += sleep_minutes
            });

            // Finally, set the total sleep front-matter.
            this.updateFrontMatter(date, this.settings.total_sleep_field, String(total_sleep_minutes))
        }
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
            new Notice("No data to update; this is normal just after a HA restart.")
            return null
        }

        if (response.status != 200) {
            new Notice("unable to fetch Health Connect data; check plugin configuration")
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
