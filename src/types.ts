///
/// Datatypes.
/// These are designed to match the format used by the Health Connect uploader.
///

/// A string in YYYY-MM-DD format.
export type date = string

/// A unix timestamp, in seconds since the epoch.
export type timestamp = number

/// An integer number of seconds.
export type seconds = number

/// A string that contains the name of a unit, e.g. "kg".
export type unit = string

// A floating point number of kilograms.
export type kilograms = number

// A number between 0 and 100, inclusive, that represents a percent.
export type percent = number

//
// Calories.
//
export type CaloriesDay = {
	energy: number
	format: unit

	/// Timestamp for the start and end of the day?
	startTime: timestamp
	endTime: timestamp
}
export type CalorieReadingSet = Record<date, CaloriesDay>


//
// Exercise.
//

export type ExerciseSession = {
	duration: seconds,
	durationFormatted: string,
	endTime: timestamp,
	exerciseName: string,
	exerciseType: string,
	notes: string | null,
	segments: any[],
	startTime: timestamp,
	title: string | null,
}

export type ExerciseDay = {
	sessions: ExerciseSession[],
	totalSessions: number,

	totalDuration: seconds,
	totalDurationFormatted: string
}
export type ExerciseReadingSet = Record<date, ExerciseDay>

//
// Heart rate.
//

export type HeartRateReading = {
	bpm: number,
	time: number,
}
export type HeartRateReadingDay = Record<timestamp, HeartRateReading>
export type HeartRateReadingSet = Record<date, HeartRateReadingDay>

//
// Hydration
//

export type HydrationDay = {
	volume: number
	format: unit

	/// Timestamp for the start and end of the day?
	startTime: timestamp
	endTime: timestamp
}
export type HydrationReadingSet = Record<date, HydrationDay>

//
// Blood oxygen.
//
export type BloodOxygenReading = Record<timestamp, percent>
export type BloodOxygenReadingSet = Record<date, BloodOxygenReading>

//
// Sleep.
//
export type SleepSession = {
	duration: seconds,
	startTime: timestamp,
	endTime: timestamp,
}

export type SleepStage = {
	stage: string // contains a magic number, so we ignore its value
	stageFormat: string
	totalTime: seconds
	totalTimeFormat: string
	occurrences: number,
	percentage: percent,
	sessions: SleepSession[]
}

export type SleepDay = {
	start: timestamp,
	end: timestamp,
	stage: SleepStage[]
}

export type SleepReadingSet = Record<date | "lastSleep", SleepDay>

//
// Steps.
//

export type StepDay = {
	count: number,
	start: timestamp,
	end: timestamp,
}
export type StepReadingSet = Record<date, StepDay>

//
// Weight.
//
export type WeightReading = Record<timestamp, kilograms>
export type WeightReadingSet = Record<date, WeightReading>

//
// Top-level sensor data.
//

export type SensorData = {
	calories: CalorieReadingSet | null | undefined
	exercise: ExerciseReadingSet | null | undefined
	heart: HeartRateReadingSet | null | undefined
	hydration: HydrationReadingSet | null | undefined
	oxygen: BloodOxygenReadingSet | null | undefined
	sleep: SleepReadingSet | null | undefined
	steps: StepReadingSet | null | undefined
	weight: WeightReadingSet | null | undefined
}

