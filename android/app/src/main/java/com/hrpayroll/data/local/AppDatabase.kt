package com.hrpayroll.data.local

import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.RoomDatabase
import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

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

@Database(entities = [PendingAttendanceEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pendingAttendanceDao(): PendingAttendanceDao
}
