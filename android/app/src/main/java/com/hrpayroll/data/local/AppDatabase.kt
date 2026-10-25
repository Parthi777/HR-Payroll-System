package com.hrpayroll.data.local

import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.RoomDatabase
import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/** Offline queue for attendance captured without connectivity (synced via WorkManager). */
@Entity(tableName = "pending_attendance")
data class PendingAttendanceEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val type: String, // "CHECK_IN" | "CHECK_OUT"
    val selfiePath: String,
    val lat: Double,
    val lng: Double,
    val capturedAt: Long,
)

@Dao
interface PendingAttendanceDao {
    @Insert
    suspend fun insert(entity: PendingAttendanceEntity)

    @Query("SELECT * FROM pending_attendance ORDER BY capturedAt ASC")
    suspend fun getAll(): List<PendingAttendanceEntity>

    @Query("DELETE FROM pending_attendance WHERE id = :id")
    suspend fun delete(id: Long)
}

/**
 * A live-tracking fix (kind FIX) or a GPS on/off event, waiting to be uploaded.
 * Kept until the server has it, so a phone with no signal loses nothing.
 */
@Entity(tableName = "gps_points")
data class GpsPointEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val attendanceId: String,
    val kind: String, // FIX | GPS_OFF | GPS_ON | NO_PERMISSION | STOPPED
    val lat: Double? = null,
    val lng: Double? = null,
    val accuracy: Float? = null,
    val ts: Long,
    val mock: Boolean = false,
)

@Dao
interface GpsPointDao {
    @Insert
    suspend fun insert(point: GpsPointEntity)

    @Query("SELECT DISTINCT attendanceId FROM gps_points")
    suspend fun attendanceIds(): List<String>

    @Query("SELECT * FROM gps_points WHERE attendanceId = :attendanceId ORDER BY ts ASC LIMIT :limit")
    suspend fun oldest(attendanceId: String, limit: Int): List<GpsPointEntity>

    @Query("DELETE FROM gps_points WHERE id IN (:ids)")
    suspend fun deleteIds(ids: List<Long>)

    @Query("DELETE FROM gps_points WHERE attendanceId = :attendanceId")
    suspend fun deleteFor(attendanceId: String)

    @Query("DELETE FROM gps_points")
    suspend fun deleteAll()
}

@Database(entities = [PendingAttendanceEntity::class, GpsPointEntity::class], version = 2, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pendingAttendanceDao(): PendingAttendanceDao
    abstract fun gpsPointDao(): GpsPointDao

    companion object {
        /** v2: the live-tracking upload queue. Exactly what Room generates for [GpsPointEntity]. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `gps_points` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                        "`attendanceId` TEXT NOT NULL, `kind` TEXT NOT NULL, `lat` REAL, `lng` REAL, `accuracy` REAL, " +
                        "`ts` INTEGER NOT NULL, `mock` INTEGER NOT NULL)",
                )
            }
        }
    }
}
